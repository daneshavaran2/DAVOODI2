// تشخیص گفتار فارسی روی خود سرور با whisper.cpp (بدون وابستگی به گوگل یا سرویس خارجی).
// مرورگر صدا را به شکل WAV (۱۶ کیلوهرتز، تک‌کاناله، ۱۶ بیتی) می‌فرستد و این ماژول آن را با زبان فارسی و
// یک «پرامپت» شامل نام خودروها به متن تبدیل می‌کند:
//   - whisper-server (پیش‌فرض): یک بار اجرا می‌شود و مدل همیشه در حافظه است؛ هر جمله بدون بار کردن مدل.
//   - whisper-cli: اگر whisper-server نبود یا از کار افتاد، برای هر جمله یک بار اجرا می‌شود.

import { spawn } from 'node:child_process';
import net from 'node:net';
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpuLimit, memoryLimitBytes, memoryStatus } from './memory.js';

const ROOT = fileURLToPath(new URL('../whisper/', import.meta.url));
/** پوشهٔ مدل‌ها (در کانتینر، دیسک لیارا می‌تواند این‌جا وصل شود) */
export const MODELS_DIR = process.env.WHISPER_MODELS_DIR || join(ROOT, 'models');
/** مدلی که هنگام ساخت تصویر Docker داخل خود تصویر گذاشته می‌شود (برای سرور بدون دیسک) */
export const BUNDLED_DIR = process.env.WHISPER_BUNDLED_DIR || join(ROOT, 'bundled');

// حافظهٔ لازم برای هر مدل، از اندازه‌گیری بیشینهٔ حافظهٔ whisper-cli روی جملهٔ فارسی، به‌اضافهٔ Node و حاشیه:
//   turbo q8_0: ۱۱۰۷ مگابایت ← ۱۴۰۰؛  turbo q5_0: ۷۳۱ (جملهٔ کوتاه) تا ۸۲۶ (۱۶ ثانیه) مگابایت ← ۹۰۰
// دقت این دو روی ۳۰ جملهٔ آزمون یکی است (۱۶ و ۱۷ درست)؛ q8_0 حدود دو برابر سریع‌تر است.
export const MODEL_MIN_MB = { 'large-v3-turbo-q8_0': 1400, 'large-v3-turbo-q5_0': 900, 'large-v3-turbo': 2000 };
export const minMemoryFor = (name) => MODEL_MIN_MB[name] ?? 1400;
const nameOf = (path) => (path ? path.split(/[\\/]/).pop().replace(/^ggml-/, '').replace(/\.bin$/, '') : null);

// پرامپت اولیه: Whisper نام‌های خاص را بهتر می‌شنود اگر پیش‌تر در «متن قبلی» آمده باشند.
// فقط نام‌ها، بدون عدد: در آزمایش، عدد در پرامپت باعث می‌شد Whisper عددهای اشتباه بنویسد.
export const DEFAULT_PROMPT =
  'پژو، پراید، سمند، دنا، تیبا، ساینا، کوییک، شاهین، تارا، رانا، هایما، چری تیگو، تویوتا کمری، کیا سراتو، مدل.';

// اگر WHISPER_MODEL تعیین نشده باشد، بهترین مدل موجود (در whisper/models یا مدل داخل تصویر) که در حافظهٔ
// برنامه جا می‌شود انتخاب می‌شود.
// q8_0 روی CPU چند برابر سریع‌تر از q5_0 است (در آزمایش: ۲٫۷ در برابر ۷٫۷ ثانیه).
const MODEL_PREFERENCE = [
  'large-v3-turbo-q8_0', 'large-v3-turbo', 'large-v3-turbo-q5_0', 'medium-q8_0', 'medium', 'medium-q5_0',
  'small-q8_0', 'small', 'small-q5_1', 'base-q8_0', 'base', 'base-q5_1', 'tiny-q8_0', 'tiny', 'tiny-q5_1',
];

// پنجرهٔ صوتی کوتاه‌تر (512 ≈ ۱۰ ثانیه به جای ۳۰) رمزگذار را حدود ۳ برابر سریع‌تر می‌کند و حافظهٔ کمتری می‌گیرد؛
// برای صدای بلندتر، پنجره به اندازهٔ همان صدا (به‌اضافهٔ یک ثانیه) است، نه کل ۳۰ ثانیه.
const SHORT_AUDIO_CTX = 512;
const FULL_AUDIO_CTX = 1500; // ۳۰ ثانیه
const CTX_PER_SECOND = 50;

export const LIMITS = { minSeconds: 0.3, maxSeconds: 30, maxBytes: 16000 * 2 * 30 + 1024 };

/** تنظیمات از متغیرهای محیطی؛ هر بار خوانده می‌شود تا تغییر بدون راه‌اندازی دوباره هم اثر کند. */
export async function sttConfig(env = process.env) {
  // سقف حافظه (WHISPER_MEMORY_LIMIT_MB برای جاهایی که cgroup دیده نمی‌شود، و برای آزمون)
  const memoryLimitMB = Number(env.WHISPER_MEMORY_LIMIT_MB) || Math.round((await memoryLimitBytes()) / 2 ** 20);
  let model = env.WHISPER_MODEL || null;
  if (!model) {
    const found = [];
    for (const dir of [MODELS_DIR, BUNDLED_DIR]) {
      const files = await readdir(dir).catch(() => []);
      for (const m of MODEL_PREFERENCE) if (files.includes(`ggml-${m}.bin`)) found.push({ m, path: join(dir, `ggml-${m}.bin`) });
    }
    found.sort((a, b) => MODEL_PREFERENCE.indexOf(a.m) - MODEL_PREFERENCE.indexOf(b.m));
    // اگر هیچ مدلی جا نشود، کم‌حافظه‌ترین انتخاب می‌شود تا پیام وضعیت، کمترین حافظهٔ لازم را بگوید
    const pick = found.find((f) => minMemoryFor(f.m) <= memoryLimitMB) || [...found].sort((a, b) => minMemoryFor(a.m) - minMemoryFor(b.m))[0];
    if (pick) model = pick.path;
  }
  return {
    bin: env.WHISPER_BIN || join(ROOT, 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
    // کنار whisper-cli؛ WHISPER_PERSISTENT=0 یعنی همیشه whisper-cli
    serverBin: env.WHISPER_PERSISTENT === '0' ? null : env.WHISPER_SERVER_BIN || join(dirname(env.WHISPER_BIN || join(ROOT, 'whisper.cpp', 'build', 'bin', 'whisper-cli')), 'whisper-server'),
    // جست‌وجوی حریصانه (یک مسیر به جای ۵): در آزمایش حدود ۲۵٪ سریع‌تر، با دقت تقریباً یکسان (۱۵ در برابر ۱۶ از ۳۰)
    beamSize: Math.max(1, Number(env.WHISPER_BEAM_SIZE) || 1),
    model,
    language: env.WHISPER_LANG || 'fa',
    // به اندازهٔ سهم پردازندهٔ برنامه (نه همهٔ هسته‌های سرور)، حداکثر ۴
    threads: Number(env.WHISPER_THREADS) || Math.max(1, Math.min(4, Math.floor(await cpuLimit()))),
    prompt: env.WHISPER_PROMPT ?? DEFAULT_PROMPT,
    concurrency: Math.max(1, Number(env.WHISPER_CONCURRENCY) || 1),
    // کمتر از حافظهٔ لازم برای همین مدل (MODEL_MIN_MB)، whisper اجرا نمی‌شود تا برنامه کشته نشود
    minMemoryMB: Number(env.WHISPER_MIN_MEMORY_MB ?? minMemoryFor(nameOf(model))),
    memoryLimitMB,
    // روی سرور کم‌هسته هر جمله تا چند ده ثانیه طول می‌کشد؛ مرورگر نتیجه را جداگانه می‌پرسد، پس مهلت بلندتر است
    timeoutMs: Number(env.WHISPER_TIMEOUT_MS) || 150_000,
    // auto: برای صدای کوتاه -ac 512؛ 0: همیشه پنجرهٔ کامل؛ عدد: همان مقدار
    audioCtx: env.WHISPER_AUDIO_CTX ?? 'auto',
    extraArgs: (env.WHISPER_ARGS || '').split(/\s+/).filter(Boolean),
  };
}

export function audioCtxArgs(cfg, seconds) {
  if (cfg.audioCtx === 'auto') {
    const ctx = Math.ceil(((seconds + 1) * CTX_PER_SECOND) / 64) * 64;
    if (ctx <= SHORT_AUDIO_CTX) return ['-ac', String(SHORT_AUDIO_CTX)];
    return ctx >= FULL_AUDIO_CTX ? [] : ['-ac', String(ctx)];
  }
  const n = Number(cfg.audioCtx);
  return n > 0 ? ['-ac', String(n)] : [];
}

/** آیا whisper-cli و فایل مدل روی سرور هست؟ */
let disabledReason = null;

/** فقط برای تست. */
export function _resetDisabled() {
  disabledReason = null;
}

export async function sttStatus(cfg) {
  cfg = cfg || (await sttConfig());
  const ok = async (p, mode) => !!p && access(p, mode).then(() => true, () => false);
  const [bin, model, mem] = await Promise.all([ok(cfg.bin, FS.X_OK), ok(cfg.model, FS.R_OK), memoryStatus(cfg.minMemoryMB, cfg.memoryLimitMB)]);
  const memReason = mem.ok
    ? null
    : `حافظهٔ این برنامه (${mem.limitMB} مگابایت) برای تشخیص گفتار روی سرور کافی نیست (دست‌کم ${mem.minMB} مگابایت).`;
  return {
    available: bin && model && !disabledReason && mem.ok,
    bin,
    model,
    modelName: cfg.model ? cfg.model.split(/[\\/]/).pop() : null,
    memoryMB: mem.limitMB,
    disabledReason: disabledReason || memReason,
  };
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

/** «رانا پلاس مدل 1400 رانا پلاس مدل 1400» ← «رانا پلاس مدل 1400» (تکرار جمله، خطای رایج Whisper). */
export function dedupeRepeats(text) {
  const tok = text.split(' ');
  const key = tok.map((t) => t.replace(/[.،,؟?!؛:]/g, ''));
  for (let p = 1; p * 2 <= tok.length; p++) {
    let same = true;
    for (let i = p; i < tok.length && same; i++) same = key[i] === key[i % p];
    if (same) return tok.slice(0, p).join(' ').replace(/[.،,\s]+$/, '');
  }
  return text;
}

export function cleanTranscript(text, prompt = '') {
  let t = String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.،,؟?!\s-]+|[.،,\s-]+$/g, '');
  if (!t) return '';
  t = dedupeRepeats(t);
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

// زمان اجراهای اخیر، برای «معمولاً حدود N ثانیه» و عیب‌یابی (/api/health)
const recent = [];
export function recentRuns() {
  return recent.slice();
}
/** زمان تخمینی یک تبدیل روی همین سرور (میانهٔ اجراهای اخیر) یا null */
export function estimateMs() {
  if (!recent.length) return null;
  const v = recent.map((r) => r.ms).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
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
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      if (signal === 'SIGILL') {
        // پردازندهٔ این سرور دستوری از whisper را ندارد؛ تا راه‌اندازی دوباره خاموش می‌شود و
        // صفحه به تشخیص گفتار مرورگر برمی‌گردد (به جای خطا در هر درخواست)
        disabledReason = 'whisper روی پردازندهٔ این سرور اجرا نشد (Illegal instruction).';
        console.error(`تشخیص گفتار روی سرور خاموش شد: ${disabledReason}`);
        return reject(new SttError(`${disabledReason} از تشخیص گفتار مرورگر استفاده کنید.`, 503));
      }
      const last = err.trim().split('\n').slice(-3).join(' | ');
      const why = signal ? `سیگنال ${signal}` : `کد ${code}`;
      reject(new SttError(`whisper با خطا تمام شد (${why}): ${last}`, 500));
    });
  });
}

/** WAV ← متن فارسی. خروجی: { text, raw, ms, seconds } */
// ---------------------------------------------------------------- whisper-server (مدل همیشه در حافظه)

const persistent = { state: 'off', child: null, port: null, model: null, ready: null, crashes: [] };

/** وضعیت whisper-server برای /api/health */
export function persistentStatus() {
  return { state: persistent.state, model: persistent.model ? persistent.model.split(/[\\/]/).pop() : null };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const exists = (p) => !!p && access(p, FS.X_OK).then(() => true, () => false);

/**
 * whisper-server را با مدل فعلی راه می‌اندازد (اگر هست). خروجی: promise آماده شدن (true/false).
 * اگر از کار بیفتد، دوباره راه می‌افتد؛ سه بار در ده دقیقه یعنی خراب است و whisper-cli به کار می‌رود.
 */
export async function startPersistent(cfg, { log = console.log } = {}) {
  cfg = cfg || (await sttConfig());
  if (persistent.state === 'ready' || persistent.state === 'starting') return persistent.ready;
  if (persistent.state === 'failed' || !cfg.model || !(await exists(cfg.serverBin))) return false;
  const port = await freePort();
  const args = ['-m', cfg.model, '-t', String(cfg.threads), '-l', cfg.language, '-nt', '-sns', '--host', '127.0.0.1', '--port', String(port)];
  const child = spawn(cfg.serverBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let errTail = '';
  child.stderr.setEncoding('utf8').on('data', (d) => (errTail = (errTail + d).slice(-3000)));
  Object.assign(persistent, { state: 'starting', child, port, model: cfg.model });
  const t0 = Date.now();
  persistent.ready = new Promise((resolve) => {
    const poll = async () => {
      if (persistent.child !== child) return resolve(false);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
        if (r.status < 500 && persistent.child === child) {
          persistent.state = 'ready';
          log(`تشخیص گفتار: مدل در حافظه است (whisper-server، ${((Date.now() - t0) / 1000).toFixed(1)} ثانیه برای بار کردن).`);
          return resolve(true);
        }
      } catch {}
      if (Date.now() - t0 > 180_000) {
        child.kill('SIGKILL');
        return resolve(false);
      }
      setTimeout(poll, 400);
    };
    setTimeout(poll, 300);
  });
  child.on('exit', (code, signal) => {
    if (persistent.child !== child) return;
    Object.assign(persistent, { state: 'off', child: null });
    if (signal === 'SIGILL') {
      disabledReason = 'whisper روی پردازندهٔ این سرور اجرا نشد (Illegal instruction).';
      persistent.state = 'failed';
      return console.error(`تشخیص گفتار روی سرور خاموش شد: ${disabledReason}`);
    }
    const now = Date.now();
    persistent.crashes = persistent.crashes.filter((t) => now - t < 10 * 60_000).concat(now);
    const why = signal ? `سیگنال ${signal}` : `کد ${code}`;
    if (persistent.crashes.length >= 3) {
      persistent.state = 'failed';
      return console.error(`whisper-server سه بار از کار افتاد (${why}: ${errTail.trim().split('\n').pop() || ''})؛ از whisper-cli استفاده می‌شود.`);
    }
    console.error(`whisper-server از کار افتاد (${why})؛ دوباره راه می‌افتد.`);
    setTimeout(() => startPersistent(undefined, { log }).catch(() => {}), 2000).unref();
  });
  return persistent.ready;
}

/** فقط برای تست. */
export const _persistentChild = () => persistent.child;

export function stopPersistent() {
  const c = persistent.child;
  Object.assign(persistent, { state: 'off', child: null });
  c?.kill();
}

async function viaServer(wav, cfg, seconds) {
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  const ac = audioCtxArgs(cfg, seconds);
  const fields = {
    language: cfg.language,
    response_format: 'json',
    no_timestamps: 'true',
    suppress_nst: 'true',
    beam_size: String(cfg.beamSize),
    best_of: String(cfg.beamSize),
    audio_ctx: ac.length ? ac[1] : '0',
  };
  if (cfg.prompt) fields.prompt = cfg.prompt;
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`http://127.0.0.1:${persistent.port}/inference`, { method: 'POST', body: fd, signal: AbortSignal.timeout(cfg.timeoutMs) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `whisper-server: HTTP ${res.status}`);
  return String(body.text || '');
}

/** onStart: وقتی نوبت این صدا شد و whisper شروع کرد (برای نمایش «در صف» / «در حال تبدیل») */
export async function transcribe(wav, cfg, { onStart } = {}) {
  cfg = cfg || (await sttConfig());
  const info = parseWav(wav);
  if (info.seconds < LIMITS.minSeconds) throw new SttError('صدا خیلی کوتاه بود؛ دوباره بگویید.');
  if (info.seconds > LIMITS.maxSeconds) throw new SttError(`صدا حداکثر ${LIMITS.maxSeconds} ثانیه می‌تواند باشد.`);
  const status = await sttStatus(cfg);
  if (!status.available) throw new SttError(status.disabledReason || 'تشخیص گفتار روی سرور نصب نشده است.', 503);

  const release = await slot(cfg.concurrency);
  onStart?.();
  const t0 = Date.now();
  let dir = null;
  try {
    // whisper-server در حال بار کردن مدل است: صبر (بار کردن هم‌زمان مدل با whisper-cli حافظه را دو برابر می‌کند)
    if (persistent.state === 'starting' && persistent.model === cfg.model) await persistent.ready;
    let raw = null;
    let via = 'cli';
    if (persistent.state === 'ready' && persistent.model === cfg.model && !cfg.extraArgs.length) {
      try {
        raw = await viaServer(wav, cfg, info.seconds);
        via = 'server';
      } catch (e) {
        console.error(`whisper-server جواب نداد (${e.message})؛ این بار با whisper-cli.`);
      }
    }
    if (raw === null) {
      dir = await mkdtemp(join(tmpdir(), 'gheymat-stt-'));
      const file = join(dir, 'audio.wav');
      await writeFile(file, wav);
      const args = ['-m', cfg.model, '-f', file, '-l', cfg.language, '-t', String(cfg.threads), '-nt', '-np', '-sns'];
      args.push('-bs', String(cfg.beamSize), '-bo', String(cfg.beamSize));
      if (cfg.prompt) args.push('--prompt', cfg.prompt);
      args.push(...audioCtxArgs(cfg, info.seconds), ...cfg.extraArgs);
      raw = await run(cfg.bin, args, cfg.timeoutMs);
    }
    const ms = Date.now() - t0;
    recent.push({ ms, seconds: Math.round(info.seconds * 10) / 10, threads: cfg.threads, via, at: new Date().toISOString() });
    if (recent.length > 10) recent.shift();
    console.log(`تبدیل گفتار: ${info.seconds.toFixed(1)} ثانیه صدا در ${(ms / 1000).toFixed(1)} ثانیه (${cfg.threads} رشته، ${via === 'server' ? 'whisper-server' : 'whisper-cli'})`);
    return { text: cleanTranscript(raw, cfg.prompt), raw: raw.trim(), ms, seconds: info.seconds, via };
  } finally {
    release();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
