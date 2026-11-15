// کلاینت HTTP مشترک: کش کوتاه‌مدت، مهلت زمانی، تلاش دوباره و محدودیت هم‌زمانی برای هر سایت
// تا سایت‌ها با درخواست‌های پشت‌سرهم ما را مسدود نکنند.

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
};

const CACHE_MAX = 300;
const cache = new Map(); // key -> { exp, value }
const inflight = new Map(); // key -> Promise
const limiters = new Map(); // host -> { active, queue }

let fetchImpl = (...args) => globalThis.fetch(...args);

/** برای تست و حالت نمایشی: جایگزینی fetch. */
export function setFetch(fn) {
  fetchImpl = fn || ((...args) => globalThis.fetch(...args));
  clearCache();
}

export function clearCache() {
  cache.clear();
  inflight.clear();
}

export class SourceError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
  }
}

async function withLimit(host, max, fn) {
  let l = limiters.get(host);
  if (!l) limiters.set(host, (l = { active: 0, queue: [] }));
  if (l.active >= max) await new Promise((resolve) => l.queue.push(resolve));
  l.active++;
  try {
    return await fn();
  } finally {
    l.active--;
    const next = l.queue.shift();
    if (next) next();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function statusMessage(host, status) {
  if (status === 403) return `${host} درخواست را مسدود کرد (HTTP 403). سرور باید در ایران باشد یا IP آن مسدود شده است.`;
  if (status === 404) return `${host} چیزی در این آدرس پیدا نکرد (HTTP 404).`;
  if (status === 429) return `${host} محدودیت تعداد درخواست اعمال کرد (HTTP 429). کمی بعد دوباره امتحان کنید.`;
  if (status >= 500) return `${host} خطای داخلی داد (HTTP ${status}).`;
  return `${host} درخواست را رد کرد (HTTP ${status}).`;
}

function networkMessage(host, err) {
  const code = err?.cause?.code || err?.code || err?.name || '';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `${host} در زمان مقرر پاسخ نداد.`;
  return `اتصال به ${host} برقرار نشد (${code || 'network error'}). این سایت‌ها معمولاً فقط از داخل ایران پاسخ می‌دهند.`;
}

/**
 * درخواست HTTP با پاسخ JSON (یا متن، با as: 'text').
 * ttl بر حسب میلی‌ثانیه؛ صفر یعنی بدون کش.
 */
export async function request(url, opts = {}) {
  const { method = 'GET', headers = {}, body, ttl = 0, timeout = 15000, retries = 1, as = 'json', maxConcurrent = 2 } = opts;
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const key = `${method} ${url} ${payload ?? ''}`;
  if (ttl) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
  }
  const host = new URL(url).host;

  const run = async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(600 * attempt + Math.random() * 400);
      let res;
      try {
        res = await withLimit(host, maxConcurrent, () =>
          fetchImpl(url, {
            method,
            headers: { ...DEFAULT_HEADERS, ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
            body: payload,
            signal: AbortSignal.timeout(timeout),
            redirect: 'follow',
          }),
        );
      } catch (err) {
        lastErr = new SourceError(networkMessage(host, err));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new SourceError(statusMessage(host, res.status), { status: res.status });
        continue;
      }
      if (!res.ok) throw new SourceError(statusMessage(host, res.status), { status: res.status });
      const text = await res.text();
      if (as === 'text') return text;
      try {
        return JSON.parse(text);
      } catch {
        throw new SourceError(`${host} پاسخ غیرمنتظره (غیر JSON) داد؛ شاید صفحهٔ بررسی ربات نشان داده است.`, {
          status: res.status,
        });
      }
    }
    throw lastErr;
  };

  const p = run();
  if (!ttl) return p;
  inflight.set(key, p);
  try {
    const value = await p;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { exp: Date.now() + ttl, value });
    return value;
  } finally {
    inflight.delete(key);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
