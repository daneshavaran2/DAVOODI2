// سرور وب: صفحهٔ برنامه (public/) و API قیمت.
//   GET /api/price?q=پژو 206 مدل 1400&city=all|1|2...
//   POST /api/transcribe   صدای WAV (۱۶kHz تک‌کاناله) ← متن فارسی با whisper.cpp روی همین سرور
//   GET /api/diagnose      وضعیت دسترسی به سه سایت
//   GET /api/health
// اجرا: node server.js   (پورت با PORT، حالت نمایشی با DEMO=1)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFetch } from './src/http.js';
import { lookupAll, SOURCES } from './src/lookup.js';
import { CITIES, DEFAULT_CITIES } from './src/sources/divar.js';
import { diagnose } from './src/diagnose.js';
import { LIMITS, parseWav, SttError, sttStatus, transcribe } from './src/stt.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DEMO = process.env.DEMO === '1' || process.argv.includes('--demo');
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 20; // درخواست قیمت در دقیقه برای هر IP

if (DEMO) {
  const { createDemoFetch } = await import('./src/demo.js');
  setFetch(createDemoFetch({ delay: 250 }));
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

async function sttInfo() {
  const s = await sttStatus();
  if (s.available) return { server: true, model: s.modelName };
  return DEMO ? { server: true, model: 'demo', demo: true } : { server: false };
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

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return send(res, 400, 'Bad request'); // «%FF» و مانند آن
  }
  const file = normPath(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    const ext = extname(file);
    send(res, 200, data, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    });
  } catch {
    send(res, 404, 'Not found');
  }
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/transcribe') {
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
        const r = await transcribe(wav);
        return send(res, 200, { text: r.text, ms: r.ms, seconds: r.seconds }, { 'Cache-Control': 'no-store' });
      } catch (e) {
        if (e instanceof SttError) return send(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, demo: DEMO, stt: await sttInfo(), sources: SOURCES.map((s) => s.info) });
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
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(PORT, HOST, async () => {
    console.log(`قیمت‌یاب خودرو آماده است: http://localhost:${PORT}${DEMO ? '  (حالت نمایشی — قیمت‌ها واقعی نیستند)' : ''}`);
    const s = await sttStatus();
    console.log(
      s.available
        ? `تشخیص گفتار روی سرور: فعال (${s.modelName})`
        : DEMO
          ? 'تشخیص گفتار روی سرور: نمایشی (whisper نصب نیست؛ همیشه یک جملهٔ نمونه برمی‌گردد)'
          : 'تشخیص گفتار روی سرور: نصب نیست (bash scripts/setup-whisper.sh) — فعلاً تشخیص گفتار مرورگر استفاده می‌شود.',
    );
  });
}
