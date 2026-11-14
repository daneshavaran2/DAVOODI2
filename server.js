// سرور وب: صفحهٔ برنامه (public/) و API قیمت.
//   GET /api/price?q=پژو 206 مدل 1400&city=all|1|2...
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
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
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
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, demo: DEMO, sources: SOURCES.map((s) => s.info) });
    }

    if (url.pathname === '/api/config') {
      return send(res, 200, { demo: DEMO, cities: CITIES, defaultCities: DEFAULT_CITIES });
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
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'خطای داخلی سرور.' });
  }
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`قیمت‌یاب خودرو آماده است: http://localhost:${PORT}${DEMO ? '  (حالت نمایشی — قیمت‌ها واقعی نیستند)' : ''}`);
  });
}
