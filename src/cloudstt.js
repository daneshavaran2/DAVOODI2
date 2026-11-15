// تبدیل گفتار ابری (اختیاری): یک سرویس سازگار با OpenAI، مثلاً «هوش مصنوعی» خود لیارا (openai/whisper-1).
// برای آیفون: سافاری تشخیص گفتار فارسی ندارد و صدا باید روی سرور به متن تبدیل شود؛ روی پردازندهٔ ضعیف و
// کم‌هسته‌ی سرور این کار ده‌ها ثانیه طول می‌کشد، ولی سرویس ابری در یکی دو ثانیه جواب می‌دهد (مثل کروم که
// همین کار را با سرویس گوگل می‌کند).
//
// تنظیم با متغیرهای محیطی:
//   STT_API_URL    نشانی پایهٔ سرویس، مثلاً https://ai.liara.ir/api/<شناسهٔ‌فضای‌کاری>/v1
//                  (یا نشانی کامل …/audio/transcriptions)
//   STT_API_KEY    کلید سرویس (Bearer)
//   STT_API_MODEL  اختیاری؛ پیش‌فرض برای لیارا openai/whisper-1 و برای بقیه whisper-1
//   STT_API_TIMEOUT_MS  اختیاری؛ پیش‌فرض ۱۲۰۰۰
// اگر سرویس ابری خطا بدهد یا دیر کند، همان صدا با whisper روی خود سرور تبدیل می‌شود.
// کلید و نشانی کامل هیچ‌جا (پاسخ‌ها، صفحهٔ وضعیت، گزارش‌ها) نشان داده نمی‌شود؛ فقط نام میزبان.

const DEFAULT_TIMEOUT_MS = 12_000;
// پس از این تعداد خطای پشت‌سرهم، تا مدتی مستقیم سراغ whisper خود سرور می‌رود تا هر بار منتظر خطا نماند
const FAILS_BEFORE_PAUSE = 2;
const PAUSE_MS = 3 * 60_000;
const AUTH_PAUSE_MS = 10 * 60_000;

/** تنظیمات سرویس ابری یا null اگر تنظیم نشده یا نادرست است */
export function cloudConfig(env = process.env) {
  const key = String(env.STT_API_KEY || '').trim();
  let url = String(env.STT_API_URL || '').trim();
  if (!key || !url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (!/\/audio\/transcriptions\/?$/.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/+$/, '')}/audio/transcriptions`;
  url = u.toString();
  const model = String(env.STT_API_MODEL || '').trim() || (/(^|\.)liara\.ir$/.test(u.hostname) ? 'openai/whisper-1' : 'whisper-1');
  return { url, key, model, host: u.host, timeoutMs: Number(env.STT_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS };
}

const state = { ok: 0, failed: 0, streak: 0, lastError: null, lastErrorAt: null, pausedUntil: 0 };

/** فقط برای تست */
export function _resetCloud() {
  Object.assign(state, { ok: 0, failed: 0, streak: 0, lastError: null, lastErrorAt: null, pausedUntil: 0 });
}

/** آیا الان سراغ سرویس ابری برویم؟ (تنظیم شده و در وقفهٔ پس از خطا نیست) */
export function cloudUsable(cfg = cloudConfig()) {
  return !!cfg && Date.now() >= state.pausedUntil;
}

/** وضعیت برای /status و /api/health (بدون کلید و بدون نشانی کامل) */
export function cloudStatus(cfg = cloudConfig()) {
  if (!cfg) return { configured: false };
  return {
    configured: true,
    host: cfg.host,
    model: cfg.model,
    usable: cloudUsable(cfg),
    ok: state.ok,
    failed: state.failed,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    pausedUntil: state.pausedUntil > Date.now() ? new Date(state.pausedUntil).toISOString() : null,
  };
}

export class CloudSttError extends Error {}

function fail(message, pauseMs = 0) {
  state.failed++;
  state.streak++;
  state.lastError = message;
  state.lastErrorAt = new Date().toISOString();
  if (pauseMs || state.streak >= FAILS_BEFORE_PAUSE) state.pausedUntil = Date.now() + (pauseMs || PAUSE_MS);
  return new CloudSttError(message);
}

/** صدای WAV را به سرویس ابری می‌فرستد و متن خام را برمی‌گرداند (یا CloudSttError) */
export async function cloudTranscribe(wav, { prompt = '', language = 'fa' } = {}, cfg = cloudConfig()) {
  if (!cfg) throw new CloudSttError('سرویس ابری تنظیم نشده است.');
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  fd.append('model', cfg.model);
  fd.append('language', language);
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  if (prompt) fd.append('prompt', prompt);
  let res;
  let body;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
      body: fd,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    body = await res.text();
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw fail(timeout ? `سرویس ابری در ${+(cfg.timeoutMs / 1000).toFixed(1)} ثانیه جواب نداد.` : `اتصال به سرویس ابری ممکن نشد (${e?.cause?.code || e?.message || e}).`);
  }
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // بعضی سرویس‌ها با response_format=text متن ساده می‌دهند
  }
  if (!res.ok) {
    const detail = String(json?.error?.message || json?.error || json?.message || body || '').replace(/\s+/g, ' ').slice(0, 160);
    const why =
      res.status === 401 || res.status === 403
        ? 'کلید سرویس ابری پذیرفته نشد'
        : res.status === 402
          ? 'اعتبار حساب سرویس ابری کافی نیست'
          : res.status === 429
            ? 'سهمیهٔ سرویس ابری پر شده است'
            : res.status === 404
              ? 'نشانی یا نام مدل سرویس ابری درست نیست'
              : `سرویس ابری خطا داد`;
    const pause = [401, 402, 403, 404].includes(res.status) ? AUTH_PAUSE_MS : res.status === 429 ? PAUSE_MS : 0;
    throw fail(`${why} (HTTP ${res.status}${detail ? `: ${detail}` : ''}).`, pause);
  }
  const text = json ? json.text : body;
  if (typeof text !== 'string') throw fail('پاسخ سرویس ابری متن نداشت.');
  state.ok++;
  state.streak = 0;
  state.pausedUntil = 0;
  return text;
}
