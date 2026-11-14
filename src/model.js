// دانلود مدل Whisper هنگام راه‌اندازی، به جای قرار دادن آن در تصویر Docker
// (تا ساخت روی لیارا از سقف زمانی رد نشود). دانلود در پس‌زمینه است: سایت فوراً بالا می‌آید و
// تشخیص گفتار سرور پس از پایان دانلود خودکار فعال می‌شود. دانلود نیمه‌کاره ادامه داده می‌شود
// و درستی فایل با sha256 بررسی می‌شود.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { memoryStatus } from './memory.js';
import { MODELS_DIR, sttConfig } from './stt.js';

export const DEFAULT_MODEL = 'large-v3-turbo-q8_0';
export const KNOWN_SHA256 = {
  'large-v3-turbo-q8_0': '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
};

/** وضعیت دانلود برای /api/health */
export const download = { state: 'idle', model: null, percent: 0, error: null };

const exists = (p) => access(p).then(() => true, () => false);

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function fetchOnce(url, part, fetchImpl, log) {
  let start = await stat(part).then((s) => s.size, () => 0);
  const res = await fetchImpl(url, { headers: start ? { Range: `bytes=${start}-` } : {}, redirect: 'follow' });
  if (res.status === 200 && start) start = 0; // سرور ادامهٔ دانلود را پشتیبانی نکرد؛ از اول
  else if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const total = start + Number(res.headers.get('content-length') || 0);
  let done = start;
  let lastLogged = -10;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    if (total) {
      download.percent = Math.floor((done / total) * 100);
      if (download.percent >= lastLogged + 10) {
        lastLogged = download.percent - (download.percent % 10);
        log(`دانلود مدل: ${download.percent}٪`);
      }
    }
  });
  await pipeline(body, createWriteStream(part, { flags: start ? 'a' : 'w' }));
}

/**
 * اگر مدلی موجود نیست، آن را دانلود می‌کند. خروجی: وضعیت نهایی (ready | skipped | failed).
 * env: WHISPER_MODEL_NAME (none = بدون مدل)، WHISPER_MODEL_URL، WHISPER_MODEL_SHA256، WHISPER_MIN_MEMORY_MB
 */
export async function ensureModel({ env = process.env, modelsDir = MODELS_DIR, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const name = env.WHISPER_MODEL_NAME || DEFAULT_MODEL;
  download.model = name;
  const cfg = await sttConfig(env);
  const dest = join(modelsDir, `ggml-${name}.bin`);
  const present =
    (await exists(dest)) ||
    (env.WHISPER_MODEL && (await exists(env.WHISPER_MODEL))) ||
    (modelsDir === MODELS_DIR && cfg.model && (await exists(cfg.model)));
  if (present) return (download.state = 'ready');
  if (name === 'none' || env.WHISPER_AUTO_DOWNLOAD === '0') return (download.state = 'skipped');

  const mem = await memoryStatus(cfg.minMemoryMB);
  if (!mem.ok) {
    download.state = 'skipped';
    download.error = `حافظهٔ برنامه ${mem.limitMB} مگابایت است؛ مدل دست‌کم ${mem.minMB} مگابایت می‌خواهد.`;
    log(`مدل دانلود نشد: ${download.error} تشخیص گفتار مرورگر استفاده می‌شود.`);
    return download.state;
  }

  const url = env.WHISPER_MODEL_URL || `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
  const part = `${dest}.part`;
  const expected = env.WHISPER_MODEL_SHA256 ?? KNOWN_SHA256[name] ?? '';
  download.state = 'downloading';
  download.error = null;
  log(`دانلود مدل ${name} از ${new URL(url).host} ...`);
  try {
    await mkdir(modelsDir, { recursive: true });
    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await fetchOnce(url, part, fetchImpl, log);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        log(`دانلود مدل قطع شد (${e.message})؛ تلاش ${attempt} از ۴`);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * attempt)));
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
