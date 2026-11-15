// انتخاب مدل Whisper به اندازهٔ حافظهٔ برنامه، و مدلِ داخل تصویر Docker برای سرور بدون دیسک.
// پوشه‌های مدل هنگام بارگذاری src/stt.js خوانده می‌شوند، پس این آزمون در فایل جدا و پیش از import تنظیمشان می‌کند.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'models-'));
const disk = join(root, 'models');
const bundled = join(root, 'bundled');
await mkdir(disk);
await mkdir(bundled);
process.env.WHISPER_MODELS_DIR = disk;
process.env.WHISPER_BUNDLED_DIR = bundled;
const BIN = join(root, 'whisper-cli');
await writeFile(BIN, '#!/bin/sh\necho ok\n');
await chmod(BIN, 0o755);

const { sttConfig, sttStatus, minMemoryFor } = await import('../src/stt.js');
const { defaultModelFor, ensureModel } = await import('../src/model.js');
const quiet = () => {};
const pick = async (mb) => {
  const cfg = await sttConfig({ WHISPER_BIN: BIN, WHISPER_MEMORY_LIMIT_MB: String(mb) });
  return { file: cfg.model?.split('/').pop() || null, min: cfg.minMemoryMB, status: await sttStatus(cfg) };
};

test('سهم پردازنده: رشته‌های whisper بیشتر از سهم کانتینر نیست', async () => {
  const { cpuLimit } = await import('../src/memory.js');
  const cpu = await cpuLimit();
  assert.ok(cpu > 0);
  const cfg = await sttConfig({ WHISPER_BIN: BIN });
  assert.equal(cfg.threads, Math.max(1, Math.min(4, Math.floor(cpu))));
  assert.equal((await sttConfig({ WHISPER_BIN: BIN, WHISPER_THREADS: '3' })).threads, 3);
});

test('حافظهٔ لازم هر مدل و مدل پیش‌فرض برای دانلود', () => {
  assert.equal(minMemoryFor('large-v3-turbo-q8_0'), 1400);
  assert.equal(minMemoryFor('large-v3-turbo-q5_0'), 900);
  assert.equal(defaultModelFor(1024), 'large-v3-turbo-q5_0');
  assert.equal(defaultModelFor(2048), 'large-v3-turbo-q8_0');
});

test('سرور ۱ گیگابایتی بدون دیسک: مدل داخل تصویر (q5_0) انتخاب و فعال می‌شود', async () => {
  await writeFile(join(bundled, 'ggml-large-v3-turbo-q5_0.bin'), 'x');
  const r = await pick(1024);
  assert.equal(r.file, 'ggml-large-v3-turbo-q5_0.bin');
  assert.equal(r.min, 900);
  assert.equal(r.status.available, true);
  // و چیزی دانلود نمی‌شود (مدل هست)
  const env = { WHISPER_BIN: BIN, WHISPER_MEMORY_LIMIT_MB: '1024', WHISPER_REQUIRE_DISK: '1', WHISPER_MODEL_URL: 'http://127.0.0.1:9/never' };
  assert.equal(await ensureModel({ env, log: quiet }), 'ready');
});

test('با مدل سریع‌تر روی دیسک: با ۲ گیگابایت q8_0، با ۱ گیگابایت همان q5_0', async () => {
  await writeFile(join(disk, 'ggml-large-v3-turbo-q8_0.bin'), 'x');
  assert.equal((await pick(2048)).file, 'ggml-large-v3-turbo-q8_0.bin');
  assert.equal((await pick(1024)).file, 'ggml-large-v3-turbo-q5_0.bin');
});

test('حافظهٔ خیلی کم: خاموش، با پیام کمترین حافظهٔ لازم', async () => {
  const r = await pick(600);
  assert.equal(r.status.available, false);
  assert.match(r.status.disabledReason, /600 مگابایت/);
  assert.match(r.status.disabledReason, /900 مگابایت/);
});

test('مدل دیگری صریحاً خواسته شده: بدون دیسک و جای خالی دانلود نمی‌شود، حتی اگر مدل داخل تصویر باشد', async () => {
  const env = { WHISPER_BIN: BIN, WHISPER_MEMORY_LIMIT_MB: '2048', WHISPER_REQUIRE_DISK: '1', WHISPER_MIN_FREE_MB: String(1e9), WHISPER_MODEL_NAME: 'large-v3-turbo', WHISPER_MODEL_URL: 'http://127.0.0.1:9/never' };
  assert.equal(await ensureModel({ env, modelsDir: join(root, 'other'), log: quiet }), 'skipped');
});

test('مدل داخل تصویر بزرگ‌تر از حافظه است (q8 با ۱ گیگابایت): مدل کوچک‌تر (q5) دانلود می‌شود', async (t) => {
  const http = await import('node:http');
  const { createHash } = await import('node:crypto');
  const body = Buffer.from('q5-model-bytes');
  const asked = [];
  const srv = http.createServer((req, res) => {
    asked.push(req.url);
    res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  // فقط q8 داخل تصویر است
  const { rm } = await import('node:fs/promises');
  await rm(join(bundled, 'ggml-large-v3-turbo-q5_0.bin'), { force: true });
  await writeFile(join(bundled, 'ggml-large-v3-turbo-q8_0.bin'), 'x');
  const env = {
    WHISPER_BIN: BIN,
    WHISPER_MEMORY_LIMIT_MB: '1024',
    WHISPER_REQUIRE_DISK: '1',
    WHISPER_MIN_FREE_MB: '1',
    WHISPER_MODEL_URL: `http://127.0.0.1:${srv.address().port}/ggml-q5.bin`,
    WHISPER_MODEL_SHA256: createHash('sha256').update(body).digest('hex'),
  };
  assert.equal(await ensureModel({ env, log: quiet }), 'ready');
  assert.equal(asked.length, 1);
  const r = await pick(1024);
  assert.equal(r.file, 'ggml-large-v3-turbo-q5_0.bin');
  assert.equal(r.status.available, true);
});
