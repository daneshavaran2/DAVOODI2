// سرور وب: صفحهٔ برنامه (public/) و API قیمت.
//   GET /api/price?q=پژو 206 مدل 1400&city=all|1|2...
//   POST /api/transcribe   صدای WAV (۱۶kHz تک‌کاناله) ← متن فارسی با whisper.cpp روی همین سرور
//   GET /api/rivals?q=...&ref=...  خودروهای هم‌رده (و قیمت صفر هر کدام)
//   GET /api/diagnose      وضعیت دسترسی به سایت‌ها
//   GET /api/health
// اجرا: node server.js   (پورت با PORT، حالت نمایشی با DEMO=1)

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFetch } from './src/http.js';
import { lookupAll, SOURCES } from './src/lookup.js';
import { CITIES, DEFAULT_CITIES } from './src/sources/divar.js';
import { diagnose } from './src/diagnose.js';
import { findRivals } from './src/rivals.js';
import { cloudConfig, cloudStatus } from './src/cloudstt.js';
import { estimateMs, LIMITS, parseWav, persistentStatus, recentRuns, startPersistent, stopPersistent, SttError, sttConfig, sttStatus, transcribe } from './src/stt.js';
import { cpuInfo, cpuLimit } from './src/memory.js';
import { download, ensureModel } from './src/model.js';

const PORT = Number(process.env.PORT) || 3000;
// بدون HOST: روی همهٔ نشانی‌ها، هم IPv4 و هم IPv6 («::»؛ اگر IPv6 نبود، 0.0.0.0). برخی سکوها
// (مثلاً پراکسی کنار کانتینر) از ::1 یا IPv6 وصل می‌شوند و گوش دادن فقط روی 0.0.0.0 به خطای 502 می‌رسد.
const HOST = process.env.HOST || undefined;
const where = (a) => (a.address === '::' ? `همهٔ نشانی‌ها (IPv4 و IPv6)، پورت ${a.port}` : `${a.address}:${a.port}`);
// پورت‌های اضافه (مثلاً 80,8080 در Docker): اگر سکو ترافیک را به پورتی جز PORT بفرستد، باز هم کار کند
const EXTRA_PORTS = [...new Set(String(process.env.EXTRA_PORTS || '').split(',').map(Number))].filter(
  (p) => p > 0 && p < 65536 && p !== PORT,
);
const DEMO = process.env.DEMO === '1' || process.argv.includes('--demo');
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 20; // درخواست قیمت در دقیقه برای هر IP

if (DEMO) {
  const { createDemoFetch } = await import('./src/demo.js');
  setFetch(createDemoFetch({ delay: 250, extra: true }));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self)',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isJson ? MIME['.json'] : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

// محدودیت سادهٔ تعداد درخواست برای هر IP تا سایت‌های منبع ما را مسدود نکنند
const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (list.length >= RATE_LIMIT) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new SttError('فایل صوتی بیش از حد بزرگ است.', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// در حالت نمایشی بدون whisper، یک جملهٔ ثابت برمی‌گردد تا مسیر ضبط صدا قابل آزمایش باشد
const DEMO_TRANSCRIPT = 'پژو دویست و شش تیپ دو مدل هزار و چهارصد';

async function sttInfo({ detail = false } = {}) {
  const s = await sttStatus();
  const cloud = cloudStatus();
  if (s.available || cloud.configured) {
    if (!detail) return { server: true, model: cloud.usable ? `${cloud.model} (ابری)` : s.modelName, estimateMs: estimateMs() };
    const cfg = await sttConfig();
    return {
      server: true,
      cloud,
      local: s.available ? 'ready' : s.disabledReason || (['downloading', 'verifying'].includes(download.state) ? download.state : 'off'),
      download: s.available || download.state === 'idle' ? undefined : { state: download.state, model: download.model, percent: download.percent },
      model: s.modelName,
      threads: cfg.threads,
      cpu: await cpuLimit(),
      cpuModel: (await cpuInfo()).model,
      cpuFlags: (await cpuInfo()).flags,
      memoryMB: s.memoryMB,
      persistent: persistentStatus(),
      estimateMs: estimateMs(),
      recent: recentRuns(),
    };
  }
  if (DEMO) return { server: true, model: 'demo', demo: true };
  // چرا تشخیص گفتار سرور فعال نیست (برای صفحه، /api/health و عیب‌یابی)
  const preparing = ['downloading', 'verifying'].includes(download.state);
  return {
    server: false,
    reason: preparing
      ? null
      : download.error || s.disabledReason || (!s.bin ? 'whisper روی سرور نصب نیست.' : !s.model ? 'مدل تشخیص گفتار روی سرور نیست.' : null),
    download: download.state === 'idle' ? undefined : { state: download.state, model: download.model, percent: download.percent },
  };
}

// کارهای تبدیل گفتار: مرورگر صدا را می‌فرستد و فوراً شمارهٔ کار می‌گیرد، سپس هر چند ثانیه نتیجه را می‌پرسد.
// تبدیلِ طولانی روی سرور کم‌هسته (ده‌ها ثانیه) به مهلت درخواست در پراکسی سکو (لیارا) نمی‌خورد.
const jobs = new Map();
const JOB_TTL_MS = 10 * 60_000;
const MAX_PENDING_JOBS = 20;

function startJob(wav) {
  const id = randomBytes(9).toString('base64url');
  const job = { id, state: 'queued', created: Date.now() };
  jobs.set(id, job);
  job.done = transcribe(wav, undefined, { onStart: () => Object.assign(job, { state: 'running', started: Date.now() }) })
    .then((r) => Object.assign(job, { state: 'done', text: r.text, raw: r.raw, ms: r.ms, seconds: r.seconds, via: r.via, model: r.model }))
    .catch((e) => Object.assign(job, { state: 'error', error: e instanceof SttError ? e.message : 'تبدیل گفتار به متن ممکن نشد.' }))
    .finally(() => setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref());
  return job;
}

/** تا waitS ثانیه (حداکثر ۲۵) صبر برای پایان کار؛ تبدیل کوتاه در همان درخواست جواب می‌گیرد، بی‌پرسش دوباره */
async function waitForJob(job, waitS) {
  const ms = Math.min(25, Math.max(0, Number(waitS) || 0)) * 1000;
  if (!ms || job.state === 'done' || job.state === 'error') return;
  let timer;
  await Promise.race([job.done, new Promise((r) => (timer = setTimeout(r, ms)))]);
  clearTimeout(timer);
}

function jobView(job) {
  const { state, text, raw, error, ms, seconds, via, model } = job;
  return { job: job.id, state, text, raw, error, ms, seconds, via, model, waitedMs: Date.now() - job.created, estimateMs: estimateMs() };
}

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const escHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** وضعیت سرور به فارسی و ساده (برای صاحب برنامه): تبدیل گفتار، پردازنده، حافظه و زمان تبدیل‌های اخیر */
async function statusPage() {
  const stt = await sttInfo({ detail: true });
  const ci = await cpuInfo();
  const sec = (ms) => (ms ? `${faNum((ms / 1000).toFixed(1))} ثانیه` : '—');
  const rows = [];
  const c = stt.cloud || cloudStatus();
  rows.push([
    'تبدیل گفتار ابری (سریع، برای آیفون)',
    !c.configured
      ? 'تنظیم نشده (STT_API_URL و STT_API_KEY)'
      : `${c.usable ? 'روشن' : 'موقتاً کنار گذاشته شده'} — ${c.host}؛ موفق ${faNum(c.ok)}، ناموفق ${faNum(c.failed)}` +
        (c.lastModel ? `؛ آخرین جواب از ${c.lastModel}` : '') +
        (c.lastError ? `؛ آخرین خطا: ${c.lastError}` : ''),
  ]);
  for (const m of c.models || []) {
    rows.push([
      `مدل ابری ${faNum((c.models.indexOf(m) + 1))}`,
      `${m.id} (${m.kind === 'chat' ? 'گفت‌وگوی صوتی، با فهرست نام خودروها' : 'تبدیل گفتار'})${m.skipped ? ' — موقتاً کنار گذاشته شده' : ''}${m.lastError ? `؛ خطا: ${m.lastError}` : ''}`,
    ]);
  }
  const localOn = stt.server && (stt.local === undefined || stt.local === 'ready');
  rows.push(['تبدیل گفتار روی خود سرور', localOn ? 'روشن' : `خاموش${stt.reason ? ` — ${stt.reason}` : typeof stt.local === 'string' && stt.local !== 'off' ? ` — ${stt.local}` : ''}`]);
  if (stt.download) rows.push(['آماده شدن مدل', `${stt.download.state} ${faNum(stt.download.percent ?? '')}٪`]);
  if (localOn && !stt.demo) {
    rows.push(['مدل', stt.model]);
    rows.push(['مدل همیشه در حافظه (whisper-server)', stt.persistent?.state === 'ready' ? 'بله' : stt.persistent?.state || '—']);
    rows.push(['زمان معمول هر جمله', sec(stt.estimateMs)]);
    rows.push(['رشته‌های پردازش', faNum(stt.threads)]);
  }
  rows.push(['سهم پردازنده', `${faNum(await cpuLimit())} هسته`]);
  rows.push(['پردازنده', `${ci.model || '—'}${ci.flags.length ? ` (${ci.flags.join('، ')})` : ''}`]);
  rows.push(['حافظهٔ برنامه', `${faNum((await sttStatus()).memoryMB)} مگابایت`]);
  const recent = (stt.recent || [])
    .slice()
    .reverse()
    .map((r) => `<li>${faNum(r.seconds)} ثانیه صدا ← ${sec(r.ms)} (${r.via === 'cloud' ? 'ابری' : `${r.via === 'server' ? 'whisper-server' : 'whisper-cli'}، ${faNum(r.threads)} رشته`})</li>`)
    .join('');
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>وضعیت سرور</title><style>body{font:18px/1.9 Tahoma,system-ui,sans-serif;margin:0;padding:20px 16px;background:#0e1b2c;color:#f3f5f8}
h1{font-size:22px;margin:0 0 12px}table{width:100%;border-collapse:collapse}td{padding:10px 6px;border-bottom:1px solid #2a3a52;vertical-align:top}
td:first-child{color:#b8c3d3;width:45%}ul{padding-inline-start:20px}</style></head><body>
<h1>وضعیت سرور</h1><table>${rows.map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${escHtml(v)}</td></tr>`).join('')}</table>
<h1 style="margin-top:20px">تبدیل‌های اخیر</h1>${recent ? `<ul>${recent}</ul>` : '<p>هنوز تبدیلی انجام نشده است.</p>'}
</body></html>`;
}

function clientIp(req) {
  const fwd = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || 'unknown';
}

function citiesParam(v) {
  if (!v || v === 'all') return DEFAULT_CITIES;
  const ids = String(v)
    .split(',')
    .filter((c) => c in CITIES);
  return ids.length ? ids : DEFAULT_CITIES;
}

// کش مرورگر: صفحه، اسکریپت‌ها و استایل هر بار با سرور چک می‌شوند (ETag؛ اگر عوض نشده باشند، پاسخ ۳۰۴ بی‌بدنه)،
// تا بعد از هر استقرار، صفحهٔ تازه با اسکریپت قدیمیِ کش‌شده اجرا نشود. فونت و آیکون کش طولانی دارند.
const etagOf = (data) => `"${createHash('sha1').update(data).digest('base64url').slice(0, 22)}"`;
const cacheFor = (ext) =>
  ext === '.woff2' ? 'public, max-age=31536000, immutable' : ['.png', '.svg', '.ico'].includes(ext) ? 'public, max-age=86400' : 'no-cache';

/** در index.html نشانی اسکریپت و استایل نسخه‌دار می‌شود (‎/app.js?v=…‎) تا کش قدیمی دور زده شود */
async function versionAssets(html) {
  const names = ['app.js', 'style.css'];
  const versions = await Promise.all(
    names.map((n) => readFile(join(PUBLIC, n)).then((d) => etagOf(d).slice(1, 11), () => null)),
  );
  return names.reduce((h, n, i) => (versions[i] ? h.replaceAll(`"/${n}"`, `"/${n}?v=${versions[i]}"`) : h), html);
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return send(res, 400, 'Bad request'); // «%FF» و مانند آن
  }
  const file = normPath(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  let data;
  try {
    data = await readFile(file);
  } catch {
    return send(res, 404, 'Not found');
  }
  const ext = extname(file);
  if (rel === 'index.html') data = Buffer.from(await versionAssets(data.toString('utf8')));
  const etag = etagOf(data);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheFor(ext), ETag: etag };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, 'Cache-Control': headers['Cache-Control'], ETag: etag });
    return res.end();
  }
  send(res, 200, data, headers);
}

// برای عیب‌یابی استقرار (مثلاً خطای 502 لیارا): آیا درخواستی به برنامه می‌رسد، از کجا و روی کدام پورت؟
// فقط ده درخواست اول ثبت می‌شود.
let requestsLogged = 0;
let logRequests = false; // فقط وقتی سرور واقعاً اجرا شده (نه در آزمون‌ها)

async function handle(req, res) {
  if (logRequests && requestsLogged < 10) {
    requestsLogged++;
    const ip = String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
    console.log(`درخواست رسید: ${req.method} ${String(req.url).slice(0, 80)} (پورت ${req.socket.localPort}، از ${ip})`);
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/transcribe') {
      if (req.method === 'GET' && url.searchParams.get('job')) {
        const job = jobs.get(url.searchParams.get('job'));
        if (!job) return send(res, 404, { error: 'این تبدیل پیدا نشد (شاید سرور دوباره راه افتاده است)؛ دوباره بگویید.' });
        await waitForJob(job, url.searchParams.get('wait'));
        return send(res, 200, jobView(job), { 'Cache-Control': 'no-store' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      if (!allowed(clientIp(req))) {
        return send(res, 429, { error: 'تعداد درخواست‌ها زیاد است؛ یک دقیقه صبر کنید.' }, { 'Retry-After': '60' });
      }
      try {
        const wav = await readBody(req, LIMITS.maxBytes);
        const stt = await sttInfo();
        if (stt.demo) {
          const info = parseWav(wav);
          return send(res, 200, { text: DEMO_TRANSCRIPT, ms: 0, seconds: info.seconds, demo: true });
        }
        if (url.searchParams.get('async') === '1') {
          parseWav(wav); // صدای نامعتبر همین الان خطا بدهد
          const st = await sttStatus();
          if (!st.available && !cloudConfig()) throw new SttError(st.disabledReason || 'تشخیص گفتار روی سرور نصب نشده است.', 503);
          const pending = [...jobs.values()].filter((j) => j.state === 'queued' || j.state === 'running').length;
          if (pending >= MAX_PENDING_JOBS) throw new SttError('سرور الان سرش شلوغ است؛ چند لحظه بعد دوباره بگویید.', 429);
          const job = startJob(wav);
          await waitForJob(job, url.searchParams.get('wait'));
          const finished = job.state === 'done' || job.state === 'error';
          return send(res, finished ? 200 : 202, jobView(job), { 'Cache-Control': 'no-store' });
        }
        const r = await transcribe(wav);
        return send(res, 200, { text: r.text, raw: r.raw, ms: r.ms, seconds: r.seconds, via: r.via, model: r.model }, { 'Cache-Control': 'no-store' });
      } catch (e) {
        if (e instanceof SttError) return send(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, demo: DEMO, stt: await sttInfo({ detail: true }), sources: SOURCES.map((s) => s.info) });
    }

    if (url.pathname === '/status') {
      return send(res, 200, await statusPage(), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/config') {
      return send(res, 200, { demo: DEMO, stt: await sttInfo(), cities: CITIES, defaultCities: DEFAULT_CITIES });
    }

    if (url.pathname === '/api/price') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return send(res, 400, { error: 'متن پرسش خالی است.' });
      if (q.length > 200) return send(res, 400, { error: 'متن پرسش بیش از حد طولانی است.' });
      if (!allowed(clientIp(req))) {
        return send(res, 429, { error: 'تعداد درخواست‌ها زیاد است؛ یک دقیقه صبر کنید.' }, { 'Retry-After': '60' });
      }
      const result = await lookupAll(q, { cities: citiesParam(url.searchParams.get('city')) });
      return send(res, 200, { demo: DEMO, ...result }, { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/rivals') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q || q.length > 200) return send(res, 400, { error: 'نام خودرو لازم است.' });
      if (!allowed(clientIp(req))) {
        return send(res, 429, { error: 'تعداد درخواست‌ها زیاد است؛ یک دقیقه صبر کنید.' }, { 'Retry-After': '60' });
      }
      const ref = Number(url.searchParams.get('ref')) || null;
      return send(res, 200, await findRivals(q, { ref }), { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/diagnose') {
      if (!allowed(clientIp(req))) return send(res, 429, { error: 'تعداد درخواست‌ها زیاد است.' });
      return send(res, 200, { demo: DEMO, results: await diagnose() }, { 'Cache-Control': 'no-store' });
    }

    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    // await لازم است تا خطای احتمالی همین‌جا گرفته شود و سرور از کار نیفتد
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'خطای داخلی سرور.' });
  }
}

export const server = http.createServer(handle);

const printable = (buf) => JSON.stringify(Buffer.from(buf).subarray(0, 48).toString('latin1'));

/**
 * عیب‌یابی استقرار در سطح اتصال: هر اتصال TCP (حتی اگر درخواست HTTP درستی نفرستد) و هر درخواست
 * نامعتبر، با آغاز داده‌اش، ثبت می‌شود. مثلاً اگر سکو به جای HTTP ساده، HTTPS یا HTTP/2 یا
 * PROXY protocol بفرستد، از همین خط معلوم می‌شود. پاسخ به درخواست نامعتبر همان پاسخ پیش‌فرض Node است.
 */
export function instrument(srv, log = console.log, limit = 10) {
  let conns = 0;
  let errors = 0;
  srv.on('connection', (sock) => {
    if (conns++ < limit) log(`اتصال رسید: پورت ${sock.localPort}، از ${String(sock.remoteAddress || '?').replace(/^::ffff:/, '')}`);
  });
  srv.on('clientError', (err, sock) => {
    const quietReset = err.code === 'ECONNRESET' && !err.rawPacket?.length;
    if (!quietReset && errors++ < limit) {
      log(
        `درخواست نامعتبر روی پورت ${sock.localPort}: ${err.code || err.message}` +
          (err.rawPacket?.length ? `؛ آغاز داده: ${printable(err.rawPacket)}` : ''),
      );
    }
    if (err.code === 'ECONNRESET' || !sock.writable) return sock.destroy();
    const status =
      err.code === 'HPE_HEADER_OVERFLOW'
        ? '431 Request Header Fields Too Large'
        : err.code === 'ERR_HTTP_REQUEST_TIMEOUT'
          ? '408 Request Timeout'
          : '400 Bad Request';
    sock.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  });
  return srv;
}

/**
 * پورت‌هایی که سکو (Kubernetes) برای سرویس‌ها در متغیرهای محیطی می‌گذارد، مثل APP_SERVICE_PORT=80.
 * از روی آن‌ها معلوم می‌شود سکو ترافیک را به کدام پورت برنامه می‌فرستد. فقط عدد پورت ثبت می‌شود، نه چیز دیگر.
 */
export function servicePorts(env = process.env) {
  return Object.entries(env)
    .filter(([k, v]) => /_SERVICE_PORT(_[A-Z0-9_]+)?$/.test(k) && !k.startsWith('KUBERNETES_') && /^\d{1,5}$/.test(v))
    .map(([k, v]) => `${k}=${v}`)
    .sort();
}

/** نشانی‌های شبکهٔ کانتینر (بدون loopback)، برای اینکه در لاگ معلوم باشد IPv6 دارد یا نه */
function networkAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal)
    .map((i) => i.address);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  logRequests = true;
  // با توقف برنامه، whisper-server هم بسته شود
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
      stopPersistent();
      process.exit(0);
    });
  }
  instrument(server);
  const addrs = networkAddresses();
  console.log(`نشانی‌های شبکهٔ کانتینر: ${addrs.join('، ') || 'هیچ'}${addrs.some((a) => a.includes(':')) ? '' : ' (بدون IPv6)'}`);
  const svc = servicePorts();
  if (svc.length) console.log(`پورت سرویس در تنظیمات سکو: ${svc.join('، ')}`);
  for (const p of EXTRA_PORTS) {
    const extra = instrument(http.createServer(handle));
    extra.on('error', (e) => console.log(`پورت اضافهٔ ${p} در دسترس نیست (${e.code})؛ مهم نیست اگر سکو از پورت ${PORT} استفاده کند.`));
    extra.listen(p, HOST, () => console.log(`همچنین روی ${where(extra.address())} گوش می‌دهد.`));
  }
  server.listen(PORT, HOST, async () => {
    const a = server.address();
    console.log(`دستیار هوشمند خودرو داوودی آماده است: روی ${where(a)} گوش می‌دهد${DEMO ? '  (حالت نمایشی — قیمت‌ها واقعی نیستند)' : ''}`);
    const cloud = cloudConfig();
    if (cloud) console.log(`تبدیل گفتار ابری: فعال (${cloud.host}، ${cloud.model})؛ اگر جواب نداد، whisper خود سرور.`);
    else if (process.env.STT_API_URL || process.env.STT_API_KEY) console.log('تبدیل گفتار ابری: STT_API_URL و STT_API_KEY هر دو لازم‌اند و نشانی باید https باشد؛ فعلاً خاموش.');
    const s = await sttStatus();
    if (s.available) {
      const cfg = await sttConfig();
      const ci = await cpuInfo();
      console.log(
        `تشخیص گفتار روی سرور: فعال (${s.modelName}، ${cfg.threads} رشته؛ سهم پردازنده: ${await cpuLimit()} هسته؛ ` +
          `حافظه: ${s.memoryMB} مگابایت؛ پردازنده: ${ci.model || '?'}${ci.flags.length ? ` [${ci.flags.join(' ')}]` : ''})`,
      );
      startPersistent(cfg).catch((e) => console.error('whisper-server:', e.message));
      return;
    }
    if (s.bin && !DEMO && !/Illegal instruction/.test(s.disabledReason || '')) {
      // whisper هست ولی مدلِ مناسب حافظه نه (مثلاً مدل داخل تصویر نیست، یا بزرگ‌تر از حافظهٔ پلن است): دانلود در پس‌زمینه
      console.log(`تشخیص گفتار روی سرور: هنوز آماده نیست (${s.disabledReason || 'مدل نیست'})؛ مدل مناسب آماده می‌شود.`);
      ensureModel()
        .then(async (state) => state === 'ready' && (await sttStatus()).available && startPersistent())
        .catch((e) => console.error('دانلود مدل:', e));
      return;
    }
    console.log(
      s.disabledReason
        ? `تشخیص گفتار روی سرور: خاموش — ${s.disabledReason}`
        : DEMO
          ? 'تشخیص گفتار روی سرور: نمایشی (whisper نصب نیست؛ همیشه یک جملهٔ نمونه برمی‌گردد)'
          : 'تشخیص گفتار روی سرور: نصب نیست (bash scripts/setup-whisper.sh) — فعلاً تشخیص گفتار مرورگر استفاده می‌شود.',
    );
  });
}
