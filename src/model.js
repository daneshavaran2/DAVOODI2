// دانلود مدل Whisper هنگام راه‌اندازی، به جای قرار دادن آن در تصویر Docker
// (تا ساخت روی لیارا از سقف زمانی رد نشود). دانلود در پس‌زمینه است: سایت فوراً بالا می‌آید و
// تشخیص گفتار سرور پس از پایان دانلود خودکار فعال می‌شود. دانلود نیمه‌کاره ادامه داده می‌شود
// و درستی فایل با sha256 بررسی می‌شود.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { memoryStatus } from './memory.js';
import { minMemoryFor, MODELS_DIR, sttConfig } from './stt.js';

export const DEFAULT_MODEL = 'large-v3-turbo-q8_0';
/** مدل مناسب حافظهٔ برنامه: با ۱٫۴ گیگابایت یا بیشتر q8_0 (سریع‌تر)، وگرنه q5_0 (۹۰۰ مگابایت) */
export const defaultModelFor = (limitMB) => (limitMB >= minMemoryFor('large-v3-turbo-q8_0') ? DEFAULT_MODEL : 'large-v3-turbo-q5_0');
/** اندازهٔ فایل مدل‌ها (برای بررسی جای خالی پیش از دانلود) */
export const MODEL_BYTES = { 'large-v3-turbo-q8_0': 874188075, 'large-v3-turbo-q5_0': 574041195 };
/** نشانی‌های دانلود: huggingface، و اگر از سرور باز نشد (مثلاً از ایران)، آینهٔ آن؛ درستی فایل با sha256 بررسی می‌شود */
export const modelUrls = (name) => [
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`,
  `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`,
];
const nameOf = (path) => String(path).split(/[\\/]/).pop().replace(/^ggml-/, '').replace(/\.bin$/, '');

/** جای خالی پوشه (مگابایت)، یا null اگر معلوم نیست */
async function freeMB(dir) {
  try {
    await mkdir(dir, { recursive: true });
    const st = await statfs(dir);
    return Math.round((Number(st.bavail) * Number(st.bsize)) / 2 ** 20);
  } catch {
    return null;
  }
}

export const KNOWN_SHA256 = {
  'large-v3-turbo-q8_0': '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
  'large-v3-turbo-q5_0': '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
};

/** وضعیت دانلود برای /api/health */
export const download = { state: 'idle', model: null, percent: 0, error: null };

const exists = (p) => access(p).then(() => true, () => false);

/** آیا این پوشه جایی جداگانه mount شده است (مثلاً دیسک لیارا)؟ */
export async function isMountPoint(dir, mountinfo = '/proc/self/mountinfo') {
  try {
    const real = await realpath(dir);
    const text = await readFile(mountinfo, 'utf8');
    // ستون پنجم هر خط، مسیر mount است (فاصله‌ها به‌صورت \040 نوشته می‌شوند)
    return text.split('\n').some((line) => (line.split(' ')[4] || '').replace(/\\040/g, ' ') === real);
  } catch {
    return false;
  }
}

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/**
 * GET با دنبال کردن تغییر مسیر (huggingface به CDN می‌فرستد). با http/https خود Node، نه fetch:
 * fetch در Node 22 وقتی سرور در پایان اتصال را می‌بندد و جریان مکث کرده است، خطای گرفته‌نشده می‌دهد
 * («assert(!this.paused)») و کل برنامه را می‌بندد؛ این در آزمایش با دانلود مدل پیش آمد.
 */
function httpGet(url, headers, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'gheymat-khodro', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpGet(new URL(res.headers.location, url).href, headers, redirects - 1));
      } else resolve(res);
    });
    req.setTimeout(30_000, () => req.destroy(new Error('۳۰ ثانیه بدون پاسخ')));
    req.on('error', reject);
  });
}

async function fetchOnce(url, part, log) {
  let start = await stat(part).then((s) => s.size, () => 0);
  const res = await httpGet(url, start ? { Range: `bytes=${start}-` } : {});
  if (res.statusCode === 200 && start) start = 0; // سرور ادامهٔ دانلود را پشتیبانی نکرد؛ از اول
  else if (res.statusCode !== 200 && res.statusCode !== 206) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode}`);
  }
  res.setTimeout(60_000, () => res.destroy(new Error('۶۰ ثانیه بدون داده')));
  const total = start + Number(res.headers['content-length'] || 0);
  let done = start;
  let lastLogged = -10;
  const progress = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      if (total) {
        download.percent = Math.floor((done / total) * 100);
        if (download.percent >= lastLogged + 10) {
          lastLogged = download.percent - (download.percent % 10);
          log(`دانلود مدل: ${download.percent}٪`);
        }
      }
      cb(null, chunk);
    },
  });
  await pipeline(res, progress, createWriteStream(part, { flags: start ? 'a' : 'w' }));
  if (total && done < total) throw new Error(`دانلود ناقص ماند (${done} از ${total} بایت)`);
}

/**
 * اگر مدلی موجود نیست، آن را دانلود می‌کند. خروجی: وضعیت نهایی (ready | skipped | failed).
 * env: WHISPER_MODEL_NAME (none = بدون مدل)، WHISPER_MODEL_URL، WHISPER_MODEL_SHA256، WHISPER_MIN_MEMORY_MB
 */
export async function ensureModel({ env = process.env, modelsDir = MODELS_DIR, log = console.log } = {}) {
  const cfg = await sttConfig(env);
  const name = env.WHISPER_MODEL_NAME || defaultModelFor(cfg.memoryLimitMB);
  download.model = name;
  const dest = join(modelsDir, `ggml-${name}.bin`);
  // مدلی که هست (مثلاً مدل داخل تصویر Docker) کافی است، اگر در حافظهٔ برنامه جا شود و مدل دیگری صریحاً خواسته نشده باشد
  const present =
    (await exists(dest)) ||
    (env.WHISPER_MODEL && (await exists(env.WHISPER_MODEL))) ||
    (!env.WHISPER_MODEL_NAME &&
      modelsDir === MODELS_DIR &&
      cfg.model &&
      minMemoryFor(nameOf(cfg.model)) <= cfg.memoryLimitMB &&
      (await exists(cfg.model)));
  if (present) return (download.state = 'ready');
  if (name === 'none' || env.WHISPER_AUTO_DOWNLOAD === '0') return (download.state = 'skipped');

  // در کانتینر (WHISPER_REQUIRE_DISK=1 در Dockerfile): دانلود فقط با دیسک دائمی یا جای خالی کافی؛ فایل بزرگ
  // در فضای موقتِ کم ممکن است از سقف پلن بگذرد، کانتینر از نو شروع شود و دانلود هم از نو (حلقه).
  if (env.WHISPER_REQUIRE_DISK === '1' && env.WHISPER_AUTO_DOWNLOAD !== '1' && !(await isMountPoint(modelsDir))) {
    const needMB = Number(env.WHISPER_MIN_FREE_MB) || Math.round(((MODEL_BYTES[name] || 9e8) * 2) / 2 ** 20) + 1024;
    const free = await freeMB(modelsDir);
    if (free === null || free < needMB) {
      download.state = 'skipped';
      download.error = `جای خالی برای مدل کافی نیست (${free ?? '?'} از ${needMB} مگابایت)؛ یک دیسک به ${modelsDir} وصل کنید (راهنما در README، بخش لیارا).`;
      log(`مدل دانلود نشد: ${download.error} تا آن موقع تشخیص گفتار مرورگر استفاده می‌شود.`);
      return download.state;
    }
  }

  const mem = await memoryStatus(Number(env.WHISPER_MIN_MEMORY_MB ?? minMemoryFor(name)), cfg.memoryLimitMB);
  if (!mem.ok) {
    download.state = 'skipped';
    download.error = `حافظهٔ برنامه ${mem.limitMB} مگابایت است؛ مدل دست‌کم ${mem.minMB} مگابایت می‌خواهد.`;
    log(`مدل دانلود نشد: ${download.error} تشخیص گفتار مرورگر استفاده می‌شود.`);
    return download.state;
  }

  // WHISPER_MODEL_URL می‌تواند چند نشانی جداشده با کاما باشد (مثلاً فضای ابری لیارا، سپس huggingface)
  const urls = env.WHISPER_MODEL_URL ? env.WHISPER_MODEL_URL.split(',').map((u) => u.trim()).filter(Boolean) : modelUrls(name);
  const part = `${dest}.part`;
  const expected = env.WHISPER_MODEL_SHA256 ?? KNOWN_SHA256[name] ?? '';
  download.state = 'downloading';
  download.error = null;
  try {
    await mkdir(modelsDir, { recursive: true });
    let lastErr = null;
    const tries = urls.length > 1 ? 2 : 4;
    outer: for (const url of urls) {
      log(`دانلود مدل ${name} از ${new URL(url).host} ...`);
      for (let attempt = 1; attempt <= tries; attempt++) {
        try {
          await fetchOnce(url, part, log);
          lastErr = null;
          break outer;
        } catch (e) {
          lastErr = e;
          log(`دانلود مدل از ${new URL(url).host} قطع شد (${e.message})؛ تلاش ${attempt} از ${tries}`);
          // فایل نیمه‌کارهٔ نشانی دیگر نباید با نشانی تازه ادامه داده شود
          if (attempt === tries) await rm(part, { force: true });
          else await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * attempt)));
        }
      }
    }
    if (lastErr) throw lastErr;
    if (expected) {
      download.state = 'verifying';
      const got = await sha256(part);
      if (got !== expected) {
        await rm(part, { force: true });
        throw new Error('checksum فایل مدل درست نیست؛ فایل خراب یا متفاوت است و پاک شد.');
      }
    }
    await rename(part, dest);
    download.state = 'ready';
    download.percent = 100;
    log(`مدل آماده است: ${dest}؛ تشخیص گفتار روی سرور فعال شد.`);
  } catch (e) {
    download.state = 'failed';
    download.error = e.message;
    log(
      `دانلود مدل ناموفق بود: ${e.message}. تشخیص گفتار مرورگر استفاده می‌شود. ` +
        `می‌توانید فایل ggml-${name}.bin را در ${modelsDir} بگذارید یا نشانی دیگری با WHISPER_MODEL_URL بدهید.`,
    );
  }
  return download.state;
}
