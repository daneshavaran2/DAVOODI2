// پنل مدیریت: ورود با رمز (ADMIN_PASSWORD)، آمار و گزارش جستجوها، و آموزش (قاعده‌های اصلاح و واژه‌های تازه).
// بی ADMIN_PASSWORD پنل خاموش است. نشست با کوکی امضاشده (HttpOnly، SameSite=Strict) و ۱۲ ساعت اعتبار؛
// تغییر رمز همهٔ نشست‌ها را باطل می‌کند. درخواست‌های تغییردهنده سرآیند X-Admin هم لازم دارند (در برابر CSRF).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import * as learning from './learning.js';

const COOKIE = 'dav_admin';
const SESSION_S = 12 * 3600;
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 8;

export const adminEnabled = () => Boolean(process.env.ADMIN_PASSWORD);
const sha = (s) => createHash('sha256').update(String(s)).digest();
const sessionKey = () => sha(`dav-admin-session:${process.env.ADMIN_PASSWORD}`);
const sign = (exp) => createHmac('sha256', sessionKey()).update(String(exp)).digest('base64url');
const safeEq = (a, b) => a.length === b.length && timingSafeEqual(a, b);

function cookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function isAdmin(req, now = Date.now()) {
  if (!adminEnabled()) return false;
  const v = cookie(req, COOKIE);
  const m = v && v.match(/^(\d+)\.([\w-]+)$/);
  if (!m || Number(m[1]) * 1000 < now) return false;
  return safeEq(Buffer.from(m[2]), Buffer.from(sign(m[1])));
}

const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || process.env.ADMIN_COOKIE_SECURE === '1';
const sessionCookie = (req, value, maxAge) =>
  `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

// تلاش‌های ناموفق ورود برای هر IP
const fails = new Map();
function tooMany(ip, now = Date.now()) {
  const list = (fails.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  fails.set(ip, list);
  if (fails.size > 5000) fails.clear();
  return list.length >= MAX_FAILS;
}
/** فقط برای آزمون */
export const _resetFails = () => fails.clear();

function readJson(req, limit = 16_384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('درخواست بیش از حد بزرگ است.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('JSON نامعتبر'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * مسیرهای ‎/admin/api/…‎. ctx: { log, send, clientIp, preview } (preview: آزمون یک جمله بدون گرفتن قیمت).
 * خروجی true یعنی درخواست پاسخ داده شد.
 */
export async function handleAdminApi(req, res, url, ctx) {
  const { send, log } = ctx;
  const path = url.pathname.replace(/^\/admin\/api\/?/, '');
  const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  const ok = (body, status = 200) => send(res, status, body, noStore);
  const fail = (status, error) => send(res, status, { error }, noStore);

  if (path === 'me') return ok({ enabled: adminEnabled(), loggedIn: isAdmin(req) });

  if (path === 'login') {
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    if (!adminEnabled()) return fail(503, 'پنل مدیریت خاموش است: متغیر ADMIN_PASSWORD را در تنظیمات برنامه بگذارید.');
    const ip = ctx.clientIp(req);
    if (tooMany(ip)) return fail(429, 'تلاش ناموفق زیاد بود؛ ۱۵ دقیقه بعد دوباره امتحان کنید.');
    const body = await readJson(req).catch(() => ({}));
    if (!safeEq(sha(body.password ?? ''), sha(process.env.ADMIN_PASSWORD))) {
      fails.get(ip).push(Date.now());
      return fail(401, 'رمز درست نیست.');
    }
    const exp = Math.floor(Date.now() / 1000) + SESSION_S;
    return send(res, 200, { ok: true }, { ...noStore, 'Set-Cookie': sessionCookie(req, `${exp}.${sign(exp)}`, SESSION_S) });
  }

  if (path === 'logout') {
    return send(res, 200, { ok: true }, { ...noStore, 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (!adminEnabled()) return fail(503, 'پنل مدیریت خاموش است.');
  if (!isAdmin(req)) return fail(401, 'وارد نشده‌اید.');
  // تغییرها فقط از صفحهٔ پنل (سرآیند X-Admin؛ فرم یا پیوند سایت دیگر نمی‌تواند بفرستد)
  if (req.method !== 'GET' && req.headers['x-admin'] !== '1') return fail(403, 'درخواست نامعتبر');

  try {
    if (path === 'summary' && req.method === 'GET') return ok(log.summary({ days: url.searchParams.get('days') }));

    if (path === 'searches' && req.method === 'GET') {
      const p = url.searchParams;
      return ok(
        log.list({
          offset: Math.max(0, Number(p.get('offset')) || 0),
          limit: Math.min(200, Math.max(1, Number(p.get('limit')) || 50)),
          filter: p.get('filter') || 'all',
          text: (p.get('q') || '').slice(0, 100),
        }),
      );
    }

    if (path === 'export.csv' && req.method === 'GET') {
      return send(res, 200, log.csv({ days: url.searchParams.get('days') }), {
        ...noStore,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="searches-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
    }

    if (path === 'learning' && req.method === 'GET') return ok(learning.listLearning());

    if (path === 'rules' && req.method === 'POST') {
      const b = await readJson(req);
      return ok({ rule: learning.addRule(b.from, b.to, b.note) });
    }
    const rule = path.match(/^rules\/([\w-]+)$/);
    if (rule && req.method === 'POST') {
      const b = await readJson(req);
      const r = learning.updateRule(rule[1], { enabled: b.enabled, to: b.to });
      return r ? ok({ rule: r }) : fail(404, 'قاعده پیدا نشد.');
    }
    if (rule && req.method === 'DELETE') return learning.removeRule(rule[1]) ? ok({ ok: true }) : fail(404, 'قاعده پیدا نشد.');

    if (path === 'words' && req.method === 'POST') {
      const b = await readJson(req);
      return ok(learning.addWord(b.word));
    }
    if (path === 'words' && req.method === 'DELETE') {
      return learning.removeWord(url.searchParams.get('word') || '') ? ok({ ok: true }) : fail(404, 'واژه پیدا نشد.');
    }

    if (path === 'test' && req.method === 'POST') {
      const b = await readJson(req);
      const q = String(b.q || '').trim().slice(0, 200);
      if (!q) return fail(400, 'جمله‌ای بنویسید.');
      const r = await ctx.preview(q);
      return ok({
        text: r.text,
        rules: r.rules,
        carText: r.query.carText,
        year: r.query.year?.value ?? null,
        km: r.query.km ?? null,
        condition: r.query.condition,
        car: r.canonical?.title ?? null,
      });
    }
  } catch (e) {
    // خطای اعتبارسنجی (عبارت خالی، طولانی، …) یا JSON نامعتبر
    return fail(e.status || 400, e.message);
  }
  return fail(404, 'Not found');
}
