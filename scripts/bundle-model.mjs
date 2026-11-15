// هنگام ساخت تصویر Docker: مدل Whisper را داخل تصویر می‌گذارد تا سرور بدون دیسک و بدون دسترسی به
// huggingface (که از ایران معمولاً در دسترس نیست) هم تشخیص گفتار داشته باشد.
// ساخت لیارا روی سرور آلمان است (build.location در liara.json). اگر دانلود ممکن نشد، ساخت ادامه می‌یابد
// و برنامه هنگام اجرا مثل قبل رفتار می‌کند. وابستگی به بقیهٔ کد ندارد تا لایهٔ Docker آن کش شود.
//
//   node scripts/bundle-model.mjs <نام مدل> <پوشه>      مثلاً: large-v3-turbo-q5_0 /app/whisper/bundled

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SHA256 = {
  'large-v3-turbo-q5_0': '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  'large-v3-turbo-q8_0': '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
};

const [name = 'large-v3-turbo-q5_0', dir = '/app/whisper/bundled'] = process.argv.slice(2);
if (!name || name === 'none') {
  console.log('مدلی داخل تصویر گذاشته نمی‌شود.');
  process.exit(0);
}
const url = process.env.WHISPER_MODEL_URL || `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
const dest = `${dir}/ggml-${name}.bin`;
const expected = process.env.WHISPER_MODEL_SHA256 ?? SHA256[name] ?? '';

/** درخواست GET با دنبال کردن تغییر مسیر (huggingface به CDN می‌فرستد) */
function get(target, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = target.startsWith('https:') ? https : http;
    const req = lib.get(target, { headers: { 'User-Agent': 'gheymat-khodro-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, target).href, redirects - 1));
      } else if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
      } else resolve(res);
    });
    req.setTimeout(30_000, () => req.destroy(new Error('۳۰ ثانیه بدون پاسخ')));
    req.on('error', reject);
  });
}

async function once() {
  const res = await get(url);
  res.setTimeout(30_000, () => res.destroy(new Error('۳۰ ثانیه بدون داده')));
  const hash = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  await pipeline(res, tap, createWriteStream(`${dest}.part`));
  const got = hash.digest('hex');
  if (expected && got !== expected) throw new Error(`checksum نادرست (${got.slice(0, 12)}…)`);
  await rename(`${dest}.part`, dest);
  return bytes;
}

await mkdir(dir, { recursive: true });
if (await stat(dest).then(() => true, () => false)) {
  console.log(`مدل از قبل هست: ${dest}`);
  process.exit(0);
}
const t0 = Date.now();
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const bytes = await once();
    console.log(`مدل ${name} داخل تصویر گذاشته شد (${Math.round(bytes / 2 ** 20)} مگابایت، ${Math.round((Date.now() - t0) / 1000)} ثانیه).`);
    process.exit(0);
  } catch (e) {
    await rm(`${dest}.part`, { force: true });
    console.log(`دانلود مدل ممکن نشد (${e.message})؛ تلاش ${attempt} از ۳`);
  }
}
console.log('مدل داخل تصویر گذاشته نشد؛ ساخت ادامه می‌یابد و برنامه هنگام اجرا تصمیم می‌گیرد.');
