// تشخیص گفتار فارسی روی خود سرور با whisper.cpp (بدون وابستگی به گوگل یا سرویس خارجی).
// مرورگر صدا را به شکل WAV (۱۶ کیلوهرتز، تک‌کاناله، ۱۶ بیتی) می‌فرستد و این ماژول
// whisper-cli را با زبان فارسی و یک «پرامپت» شامل نام خودروها اجرا می‌کند.

import { spawn } from 'node:child_process';
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../whisper/', import.meta.url));

// پرامپت اولیه: Whisper نام‌های خاص را بهتر می‌شنود اگر پیش‌تر در «متن قبلی» آمده باشند.
export const DEFAULT_PROMPT =
  'قیمت پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰. پراید ۱۳۱ مدل ۹۸. سمند ال ایکس، دنا پلاس، تیبا، ساینا، کوییک، شاهین، ' +
  'تارا، رانا، ری‌را، آریسان، هایما، جک، چری تیگو، فونیکس، ام‌وی‌ام، کیا سراتو، هیوندای، تویوتا کمری، رنو تندر.';

// اگر WHISPER_MODEL تعیین نشده باشد، بزرگ‌ترین مدل موجود در whisper/models انتخاب می‌شود.
const MODEL_PREFERENCE = [
  'large-v3-turbo-q8_0', 'large-v3-turbo-q5_0', 'large-v3-turbo', 'medium-q8_0', 'medium-q5_0', 'medium',
  'small', 'small-q8_0', 'small-q5_1', 'base', 'base-q8_0', 'base-q5_1', 'tiny', 'tiny-q8_0', 'tiny-q5_1',
];

export const LIMITS = { minSeconds: 0.3, maxSeconds: 30, maxBytes: 16000 * 2 * 30 + 1024 };

/** تنظیمات از متغیرهای محیطی؛ هر بار خوانده می‌شود تا تغییر بدون راه‌اندازی دوباره هم اثر کند. */
export async function sttConfig(env = process.env) {
  let model = env.WHISPER_MODEL || null;
  if (!model) {
    const files = await readdir(join(ROOT, 'models')).catch(() => []);
    const name = MODEL_PREFERENCE.find((m) => files.includes(`ggml-${m}.bin`));
    if (name) model = join(ROOT, 'models', `ggml-${name}.bin`);
  }
  return {
    bin: env.WHISPER_BIN || join(ROOT, 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
    model,
    language: env.WHISPER_LANG || 'fa',
    threads: Number(env.WHISPER_THREADS) || Math.max(1, Math.min(4, cpus().length)),
    prompt: env.WHISPER_PROMPT ?? DEFAULT_PROMPT,
    concurrency: Math.max(1, Number(env.WHISPER_CONCURRENCY) || 1),
    timeoutMs: Number(env.WHISPER_TIMEOUT_MS) || 60_000,
    extraArgs: (env.WHISPER_ARGS || '').split(/\s+/).filter(Boolean),
  };
}

/** آیا whisper-cli و فایل مدل روی سرور هست؟ */
export async function sttStatus(cfg) {
  cfg = cfg || (await sttConfig());
  const ok = async (p, mode) => !!p && access(p, mode).then(() => true, () => false);
  const [bin, model] = await Promise.all([ok(cfg.bin, FS.X_OK), ok(cfg.model, FS.R_OK)]);
  return { available: bin && model, bin, model, modelName: cfg.model ? cfg.model.split(/[\\/]/).pop() : null };
}

export class SttError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SttError';
    this.status = status;
  }
}

/** سرآیند WAV را می‌خواند و فقط PCM ۱۶ بیتی تک‌کاناله ۱۶ کیلوهرتز را می‌پذیرد. */
export function parseWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) throw new SttError('فایل صوتی خالی یا ناقص است.');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new SttError('فرمت صدا باید WAV باشد.');
  }
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = { offset: body, bytes: Math.min(size, buf.length - body) };
      break;
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new SttError('فایل WAV معتبر نیست.');
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.sampleRate !== 16000 || fmt.bits !== 16) {
    throw new SttError('صدا باید PCM ۱۶ بیتی، تک‌کاناله و ۱۶ کیلوهرتز باشد.');
  }
  const seconds = data.bytes / (fmt.sampleRate * 2);
  return { ...fmt, ...data, seconds };
}

// Whisper روی سکوت یا نویز گاهی جمله‌های ساختگی تولید می‌کند (مثلاً «زیرنویس توسط ...»).
const HALLUCINATIONS = /زیرنویس|زير نويس|subtitle|amara|thank(s| you)|ترجمه|مترجم|ادامه دارد|موسیقی|music|سابسکرایب|subscribe/i;

export function cleanTranscript(text, prompt = '') {
  let t = String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.،,؟?!\s-]+|[.،,\s-]+$/g, '');
  if (!t) return '';
  if (HALLUCINATIONS.test(t) && t.length < 80) return '';
  // تکرار خود پرامپت به جای شنیدن صدا
  if (prompt && t.length > 25 && prompt.includes(t)) return '';
  return t;
}

// صف ساده: هم‌زمان حداکثر concurrency اجرای whisper (هر اجرا چند صد مگابایت حافظه می‌گیرد)
let active = 0;
const waiting = [];
async function slot(max) {
  if (active >= max) await new Promise((resolve) => waiting.push(resolve));
  active++;
  return () => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };
}

export function queueSize() {
  return { active, waiting: waiting.length };
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const cap = 200_000;
    child.stdout.setEncoding('utf8').on('data', (d) => (out = (out + d).slice(-cap)));
    child.stderr.setEncoding('utf8').on('data', (d) => (err = (err + d).slice(-cap)));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SttError('تبدیل گفتار به متن بیش از حد طول کشید.', 504));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new SttError(`اجرای whisper ممکن نشد: ${e.message}`, 500));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else {
        const last = err.trim().split('\n').slice(-3).join(' | ');
        reject(new SttError(`whisper با خطا تمام شد (کد ${code}): ${last}`, 500));
      }
    });
  });
}

/** WAV ← متن فارسی. خروجی: { text, raw, ms, seconds } */
export async function transcribe(wav, cfg) {
  cfg = cfg || (await sttConfig());
  const info = parseWav(wav);
  if (info.seconds < LIMITS.minSeconds) throw new SttError('صدا خیلی کوتاه بود؛ دوباره بگویید.');
  if (info.seconds > LIMITS.maxSeconds) throw new SttError(`صدا حداکثر ${LIMITS.maxSeconds} ثانیه می‌تواند باشد.`);
  const status = await sttStatus(cfg);
  if (!status.available) throw new SttError('تشخیص گفتار روی سرور نصب نشده است.', 503);

  const release = await slot(cfg.concurrency);
  const dir = await mkdtemp(join(tmpdir(), 'gheymat-stt-'));
  const t0 = Date.now();
  try {
    const file = join(dir, 'audio.wav');
    await writeFile(file, wav);
    const args = ['-m', cfg.model, '-f', file, '-l', cfg.language, '-t', String(cfg.threads), '-nt', '-np', '-sns'];
    if (cfg.prompt) args.push('--prompt', cfg.prompt);
    args.push(...cfg.extraArgs);
    const raw = await run(cfg.bin, args, cfg.timeoutMs);
    return { text: cleanTranscript(raw, cfg.prompt), raw: raw.trim(), ms: Date.now() - t0, seconds: info.seconds };
  } finally {
    release();
    await rm(dir, { recursive: true, force: true });
  }
}
