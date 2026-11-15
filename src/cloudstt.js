// تبدیل گفتار ابری (اختیاری): یک سرویس سازگار با OpenAI، مثلاً «هوش مصنوعی» خود لیارا.
// برای آیفون: سافاری تشخیص گفتار فارسی ندارد و صدا باید روی سرور به متن تبدیل شود؛ روی پردازندهٔ ضعیف و
// کم‌هسته‌ی سرور این کار ده‌ها ثانیه طول می‌کشد، ولی سرویس ابری در یکی دو ثانیه جواب می‌دهد (مثل کروم که
// همین کار را با سرویس گوگل می‌کند).
//
// دو نوع مدل:
//   - مدل تبدیل گفتار (whisper، mai-transcribe، …): ‎/audio/transcriptions‎
//   - مدل گفت‌وگوی صوتی (مثلاً Gemini Flash): ‎/chat/completions‎ با صدا به‌عنوان ورودی و یک دستور که می‌گوید
//     «این یک نفر است که نام و مدل خودرو را می‌گوید» به‌همراه فهرست نام خودروها. چون زمینه را می‌داند، نام
//     خودروها را بسیار بهتر از مدل تبدیل گفتارِ ساده می‌نویسد.
//
// تنظیم با متغیرهای محیطی:
//   STT_API_URL    نشانی پایهٔ سرویس، مثلاً https://ai.liara.ir/api/<شناسهٔ‌فضای‌کاری>/v1
//   STT_API_KEY    کلید سرویس (Bearer)
//   STT_API_MODEL  یک یا چند شناسهٔ مدل، جداشده با کاما، به ترتیب ترجیح؛ اگر اولی خطا داد بعدی
//                  (پیش‌فرض برای لیارا openai/whisper-1 و برای بقیه whisper-1)
//   STT_API_TIMEOUT_MS  اختیاری؛ کل زمان سرویس ابری برای یک جمله، پیش‌فرض ۱۲۰۰۰
// اگر سرویس ابری خطا بدهد یا دیر کند، همان صدا با whisper روی خود سرور تبدیل می‌شود.
// کلید و نشانی کامل هیچ‌جا (پاسخ‌ها، صفحهٔ وضعیت، گزارش‌ها) نشان داده نمی‌شود؛ فقط نام میزبان.

const DEFAULT_TIMEOUT_MS = 12_000;
// پس از این تعداد خطای پشت‌سرهم، تا مدتی مستقیم سراغ whisper خود سرور می‌رود تا هر بار منتظر خطا نماند
const FAILS_BEFORE_PAUSE = 2;
const PAUSE_MS = 3 * 60_000;
const AUTH_PAUSE_MS = 10 * 60_000;
// مدلی که درخواست را نپذیرفت (نام نادرست، ورودی صوتی ندارد، …) تا این مدت کنار می‌رود و مدل بعدی به کار می‌رود
const MODEL_SKIP_MS = 10 * 60_000;

// مدل گفت‌وگو با ورودی صوتی (‎/chat/completions‎): خانواده‌های شناخته‌شده، یا هر شناسه با پیشوند «chat:».
// بقیه (whisper، chirp، mai-transcribe، voxtral-…-stt، qwen3-asr، …) مدل تبدیل گفتار (‎/audio/transcriptions‎) حساب می‌شوند.
const CHAT_FAMILIES = /gemini|gpt-4o-audio|gpt-audio|audio-preview|omni|mimo|claude|llama/i;
export const isChatModel = (id) => /^chat:/i.test(id) || (!/transcri|whisper|stt|asr|chirp/i.test(id) && CHAT_FAMILIES.test(id));
export const isTranscriptionModel = (id) => !isChatModel(id);
/** شناسه‌ای که به سرویس فرستاده می‌شود (بدون پیشوند chat:) */
const apiModel = (id) => id.replace(/^chat:/i, '');

/** تنظیمات سرویس ابری یا null اگر تنظیم نشده یا نادرست است */
export function cloudConfig(env = process.env) {
  const key = String(env.STT_API_KEY || '').trim();
  const url = String(env.STT_API_URL || '').trim();
  if (!key || !url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  u.pathname = u.pathname.replace(/\/(audio\/transcriptions|chat\/completions)\/?$/, '').replace(/\/+$/, '');
  u.search = '';
  const base = u.toString().replace(/\/+$/, '');
  const fallback = /(^|\.)liara\.ir$/.test(u.hostname) ? 'openai/whisper-1' : 'whisper-1';
  const models = String(env.STT_API_MODEL || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (!models.length) models.push(fallback);
  return { base, key, models, model: models[0], host: u.host, timeoutMs: Number(env.STT_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS };
}

const state = { ok: 0, failed: 0, streak: 0, lastError: null, lastErrorAt: null, lastModel: null, pausedUntil: 0 };
const perModel = new Map(); // شناسهٔ مدل ← { level, skipUntil, lastError }
const modelState = (id) => perModel.get(id) || perModel.set(id, { level: 0, skipUntil: 0, lastError: null }).get(id);

/** فقط برای تست */
export function _resetCloud() {
  perModel.clear();
  Object.assign(state, { ok: 0, failed: 0, streak: 0, lastError: null, lastErrorAt: null, lastModel: null, pausedUntil: 0 });
}

/** آیا الان سراغ سرویس ابری برویم؟ (تنظیم شده و در وقفهٔ پس از خطا نیست) */
export function cloudUsable(cfg = cloudConfig()) {
  return !!cfg && Date.now() >= state.pausedUntil;
}

/** وضعیت برای /status و /api/health (بدون کلید و بدون نشانی کامل) */
export function cloudStatus(cfg = cloudConfig()) {
  if (!cfg) return { configured: false };
  const now = Date.now();
  return {
    configured: true,
    host: cfg.host,
    model: cfg.model,
    models: cfg.models.map((id) => {
      const m = perModel.get(id);
      return { id, kind: isChatModel(id) ? 'chat' : 'transcription', skipped: !!m && m.skipUntil > now, lastError: m?.lastError || null };
    }),
    usable: cloudUsable(cfg),
    ok: state.ok,
    failed: state.failed,
    lastModel: state.lastModel,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    pausedUntil: state.pausedUntil > now ? new Date(state.pausedUntil).toISOString() : null,
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

/** خطای یک مدل: kind = 'fatal' (کلید/اعتبار: کل سرویس)، 'timeout'، 'model' (این مدل کنار برود)، 'retry' */
class ModelError extends Error {
  constructor(message, kind, pauseMs = 0) {
    super(message);
    this.kind = kind;
    this.pauseMs = pauseMs;
  }
}

async function request(url, cfg, init, timeoutMs) {
  let res;
  let body;
  try {
    res = await fetch(url, {
      ...init,
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await res.text();
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    if (timeout) throw new ModelError(`سرویس ابری در ${+(cfg.timeoutMs / 1000).toFixed(1)} ثانیه جواب نداد.`, 'timeout');
    throw new ModelError(`اتصال به سرویس ابری ممکن نشد (${e?.cause?.code || e?.message || e}).`, 'timeout');
  }
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // بعضی سرویس‌ها متن ساده برمی‌گردانند
  }
  return { res, body, json };
}

const badRequest = (status) => status === 400 || status === 422;

function httpError(model, { res, body, json }) {
  const detail = String(json?.error?.message || json?.error || json?.message || body || '').replace(/\s+/g, ' ').slice(0, 160);
  const s = res.status;
  const tail = ` (${model}، HTTP ${s}${detail ? `: ${detail}` : ''}).`;
  if (s === 401 || s === 403) return new ModelError(`کلید سرویس ابری پذیرفته نشد${tail}`, 'fatal', AUTH_PAUSE_MS);
  if (s === 402) return new ModelError(`اعتبار حساب سرویس ابری کافی نیست${tail}`, 'fatal', AUTH_PAUSE_MS);
  if (s === 429) return new ModelError(`سهمیهٔ سرویس ابری پر شده است${tail}`, 'fatal', PAUSE_MS);
  if (s === 404) return new ModelError(`نشانی یا نام مدل سرویس ابری درست نیست${tail}`, 'model');
  if (badRequest(s)) return new ModelError(`سرویس ابری این درخواست را نپذیرفت${tail}`, 'model');
  return new ModelError(`سرویس ابری خطا داد${tail}`, 'retry');
}

// فیلدهای اختیاری، از کامل به ساده: بعضی مدل‌ها (مثلاً microsoft/mai-transcribe-2) فقط فایل و مدل را می‌پذیرند
// و به فیلد ناآشنا (مثل prompt که مخصوص whisper است) خطای 400 می‌دهند. سطحی که جواب داد به خاطر سپرده می‌شود.
const TRANSCRIBE_LEVELS = [
  (o) => ({ language: o.language, response_format: 'json', temperature: '0', ...(o.prompt ? { prompt: o.prompt } : {}) }),
  (o) => ({ language: o.language }),
  () => ({}),
];

async function viaTranscriptions(wav, id, opts, cfg, timeoutMs) {
  const m = modelState(id);
  for (;;) {
    const fd = new FormData();
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    fd.append('model', apiModel(id));
    for (const [k, v] of Object.entries(TRANSCRIBE_LEVELS[m.level](opts))) fd.append(k, v);
    const r = await request(`${cfg.base}/audio/transcriptions`, cfg, { body: fd }, timeoutMs);
    if (badRequest(r.res.status) && m.level < TRANSCRIBE_LEVELS.length - 1) {
      m.level++; // همان صدا با فیلدهای کمتر
      continue;
    }
    if (!r.res.ok) {
      if (badRequest(r.res.status)) m.level = 0;
      throw httpError(id, r);
    }
    const text = r.json ? (r.json.text ?? r.json.transcript ?? r.json.results?.[0]?.transcript) : r.body;
    if (typeof text !== 'string') throw new ModelError(`پاسخ سرویس ابری متن نداشت (${id}).`, 'model');
    return text;
  }
}

// نام‌های رایج بازار خودروی ایران (با املای معمول)، برای مدل گفت‌وگوی صوتی
export const CAR_NAMES = [
  'پژو ۲۰۶', 'پژو ۲۰۷', 'پژو پارس', 'پژو ۴۰۵', 'پژو ۲۰۸', 'پژو ۳۰۱', 'پژو ۵۰۸', 'پراید', 'تیبا', 'ساینا', 'کوییک', 'شاهین',
  'سمند', 'سورن', 'دنا', 'دنا پلاس', 'رانا', 'تارا', 'آریسان', 'هایما', 'ری‌را', 'ام‌وی‌ام', 'چری تیگو ۷', 'تیگو ۸', 'آریزو ۵',
  'آریزو ۶', 'فونیکس', 'فیدلیتی', 'دیگنیتی', 'جک', 'کی‌ام‌سی', 'لاماری', 'بسترن', 'دایون', 'کارا', 'وانت نیسان', 'زامیاد',
  'تویوتا کمری', 'تویوتا کرولا', 'لندکروزر', 'پرادو', 'هیوندای سوناتا', 'هیوندای توسان', 'هیوندای النترا', 'هیوندای اکسنت',
  'سانتافه', 'کیا سراتو', 'کیا اسپورتیج', 'کیا سورنتو', 'کیا اپتیما', 'کیا ریو', 'مزدا ۳', 'رنو تندر ۹۰', 'رنو ساندرو',
  'رنو مگان', 'رنو کپچر', 'سیتروئن زانتیا', 'بی‌ام‌و', 'بنز', 'لکسوس', 'پورشه', 'فولکس‌واگن', 'شورولت', 'ولوو', 'نیسان',
];

export const CHAT_INSTRUCTIONS = `You transcribe one short voice message in Persian (Farsi).
The speaker uses an Iranian car-price app. They usually say a car's brand, model, trim and year, for example «قیمت پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰» or «سراتو مدل ۹۸», sometimes with mileage or colour.
Rules:
- Write exactly what was said, in Persian script, on one line. Do not answer the question, translate, add, guess or explain anything.
- Write numbers with Persian digits: «دویست و شش» → ۲۰۶، «نود و هشت» → ۹۸، «هزار و چهارصد» → ۱۴۰۰، «تیپ دو» → تیپ ۲.
- Spell car names the standard Iranian way. Common names: ${CAR_NAMES.join('، ')}.
- If there is no clear speech in the audio, output nothing at all.`;

// گفت‌وگو: اول با «بدون فکر کردن» (سریع‌تر برای مدل‌هایی مثل Gemini 2.5 Flash)؛ اگر نپذیرفت، ساده‌تر
const CHAT_LEVELS = [{ temperature: 0, reasoning: { effort: 'none' } }, { temperature: 0 }, {}];

/** متن خروجی مدل گفت‌وگو ← فقط خود جمله */
export function cleanChatText(text) {
  let t = String(text || '')
    .replace(/```[a-z]*\n?|```/gi, ' ')
    .trim()
    .split(/\n+/)[0]
    .trim();
  t = t.replace(/^(transcript(ion)?|text|متن( گفته‌شده)?|رونوشت)\s*[:：]\s*/i, '');
  t = t.replace(/^["'«“”]+|["'»“”]+$/g, '').trim();
  if (/^(no (clear )?speech|silence|nothing|\(?(سکوت|نامفهوم|بدون گفتار)\)?)\.?$/i.test(t)) return '';
  return t.slice(0, 200);
}

async function viaChat(wav, id, opts, cfg, timeoutMs) {
  const m = modelState(id);
  const audio = Buffer.from(wav).toString('base64');
  for (;;) {
    const payload = {
      model: apiModel(id),
      messages: [
        { role: 'system', content: CHAT_INSTRUCTIONS },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'متن دقیق این صدا را بنویس.' },
            { type: 'input_audio', input_audio: { data: audio, format: 'wav' } },
          ],
        },
      ],
      ...CHAT_LEVELS[m.level],
    };
    const r = await request(`${cfg.base}/chat/completions`, cfg, { body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }, timeoutMs);
    if (badRequest(r.res.status) && m.level < CHAT_LEVELS.length - 1) {
      m.level++;
      continue;
    }
    if (!r.res.ok) {
      if (badRequest(r.res.status)) m.level = 0;
      throw httpError(id, r);
    }
    const c = r.json?.choices?.[0]?.message?.content;
    const text = Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') : c;
    if (typeof text !== 'string') throw new ModelError(`پاسخ سرویس ابری متن نداشت (${id}).`, 'model');
    return cleanChatText(text);
  }
}

/**
 * صدای WAV را به سرویس ابری می‌فرستد. مدل‌ها به ترتیب امتحان می‌شوند؛ مدلی که درخواست را نپذیرفت تا مدتی کنار
 * می‌رود. خروجی { text, model } یا CloudSttError.
 */
export async function cloudTranscribe(wav, { prompt = '', language = 'fa' } = {}, cfg = cloudConfig()) {
  if (!cfg) throw new CloudSttError('سرویس ابری تنظیم نشده است.');
  const deadline = Date.now() + cfg.timeoutMs;
  let last = null;
  for (const id of cfg.models) {
    const m = modelState(id);
    if (Date.now() < m.skipUntil) continue;
    const left = deadline - Date.now();
    if (last && left < 1000) break; // مدل بعدی فقط اگر هنوز وقت هست
    try {
      const fn = isChatModel(id) ? viaChat : viaTranscriptions;
      const text = await fn(wav, id, { prompt, language }, cfg, left);
      m.lastError = null;
      state.ok++;
      state.streak = 0;
      state.pausedUntil = 0;
      state.lastModel = id;
      return { text, model: id };
    } catch (e) {
      if (!(e instanceof ModelError)) throw e;
      m.lastError = e.message;
      if (e.kind === 'fatal' || e.kind === 'timeout') throw fail(e.message, e.pauseMs);
      if (e.kind === 'model') m.skipUntil = Date.now() + MODEL_SKIP_MS;
      last = e;
      if (cfg.models.length > 1) console.error(`تبدیل گفتار ابری: ${e.message} مدل بعدی امتحان می‌شود.`);
    }
  }
  const earlier = cfg.models.map((id) => perModel.get(id)?.lastError).find(Boolean);
  throw fail(last?.message || `مدل‌های ابری پس از خطا چند دقیقه کنار گذاشته شده‌اند؛ آخرین خطا: ${earlier || '—'}`);
}

// مدل‌های تبدیل گفتار لیارا که در مقایسه (حالت عیب‌یابی) کنار مدل‌های تنظیم‌شده امتحان می‌شوند
export const LIARA_COMPARE_MODELS = [
  'google/chirp-3',
  'openai/gpt-transcribe',
  'microsoft/mai-transcribe-2',
  'openai/whisper-large-v3',
  'mistralai/voxtral-small-24b-2507-stt',
  'x-ai/grok-stt-1.0',
  'meta/muse-voice-transcribe-1.0',
  'fish-audio/transcribe-1',
];

/**
 * مقایسه (حالت عیب‌یابی): همان صدا هم‌زمان به مدل‌های STT_API_MODEL و (برای لیارا) مدل‌های بالا، روی‌هم دست‌کم ۸ تا،
 * فرستاده می‌شود تا صاحب
 * برنامه ببیند کدام برای صدای خودش درست‌تر است. شمارنده‌ها و مکث پس از خطا را تغییر نمی‌دهد.
 * خروجی: [{ model, kind, raw, ms, error }]
 */
export async function cloudCompare(wav, { prompt = '', language = 'fa' } = {}, cfg = cloudConfig()) {
  if (!cfg) throw new CloudSttError('سرویس ابری تنظیم نشده است.');
  const extra = /(^|\.)liara\.ir$/.test(cfg.host.replace(/:\d+$/, '')) ? LIARA_COMPARE_MODELS : [];
  const ids = [...new Set([...cfg.models, ...extra])].slice(0, Math.max(8, cfg.models.length));
  return Promise.all(
    ids.map(async (id) => {
      const t0 = Date.now();
      const kind = isChatModel(id) ? 'chat' : 'transcription';
      try {
        const fn = kind === 'chat' ? viaChat : viaTranscriptions;
        const raw = await fn(wav, id, { prompt, language }, cfg, cfg.timeoutMs);
        return { model: id, kind, raw, ms: Date.now() - t0, error: null };
      } catch (e) {
        if (!(e instanceof ModelError)) throw e;
        return { model: id, kind, raw: null, ms: Date.now() - t0, error: e.message };
      }
    }),
  );
}
