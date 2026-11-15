// دانلود مدل هنگام اجرا: checksum، ادامهٔ دانلود نیمه‌کاره، تلاش دوباره، و رد شدن وقتی حافظه کم است.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { download, ensureModel } from '../src/model.js';
import { sttConfig, sttStatus } from '../src/stt.js';

const MODEL = randomBytes(3 * 1024 * 1024 + 123);
const SHA = createHash('sha256').update(MODEL).digest('hex');

// سرور محلی به جای huggingface.co، با پشتیبانی Range
function startServer({ failFirst = 0 } = {}) {
  const seen = [];
  let failures = failFirst;
  const srv = http.createServer((req, res) => {
    seen.push(req.headers.range || null);
    if (failures > 0) {
      failures--;
      res.writeHead(500).end();
      return;
    }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const body = MODEL.subarray(start);
    res.writeHead(m ? 206 : 200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: `http://127.0.0.1:${srv.address().port}/ggml.bin` })),
  );
}

const quiet = () => {};
const baseEnv = (url, extra = {}) => ({
  WHISPER_MODEL_NAME: 'tiny-q8_0',
  WHISPER_MODEL_URL: url,
  WHISPER_MODEL_SHA256: SHA,
  WHISPER_MIN_MEMORY_MB: '0',
  ...extra,
});

test('دانلود، بررسی checksum و آماده شدن مدل', async (t) => {
  const { srv, url } = await startServer();
  t.after(() => srv.close());
  const dir = await mkdtemp(join(tmpdir(), 'model-'));
  assert.equal(await ensureModel({ env: baseEnv(url), modelsDir: dir, log: quiet }), 'ready');
  const file = join(dir, 'ggml-tiny-q8_0.bin');
  assert.deepEqual(await readFile(file), MODEL);
  assert.equal(existsSync(`${file}.part`), false);
  assert.equal(download.percent, 100);
  // بار دوم چیزی دانلود نمی‌شود
  assert.equal(await ensureModel({ env: baseEnv('http://127.0.0.1:9/never'), modelsDir: dir, log: quiet }), 'ready');
});

test('دانلود نیمه‌کاره از همان‌جا ادامه می‌یابد (Range)', async (t) => {
  const { srv, seen, url } = await startServer();
  t.after(() => srv.close());
  const dir = await mkdtemp(join(tmpdir(), 'model-'));
  await writeFile(join(dir, 'ggml-tiny-q8_0.bin.part'), MODEL.subarray(0, 1024 * 1024));
  assert.equal(await ensureModel({ env: baseEnv(url), modelsDir: dir, log: quiet }), 'ready');
  assert.deepEqual(seen, ['bytes=1048576-']);
  assert.deepEqual(await readFile(join(dir, 'ggml-tiny-q8_0.bin')), MODEL);
});

test('خطای موقت سرور: تلاش دوباره', async (t) => {
  const { srv, seen, url } = await startServer({ failFirst: 1 });
  t.after(() => srv.close());
  const dir = await mkdtemp(join(tmpdir(), 'model-'));
  assert.equal(await ensureModel({ env: baseEnv(url), modelsDir: dir, log: quiet }), 'ready');
  assert.equal(seen.length, 2);
});

test('checksum نادرست: فایل پاک می‌شود و مدل فعال نمی‌شود', async (t) => {
  const { srv, url } = await startServer();
  t.after(() => srv.close());
  const dir = await mkdtemp(join(tmpdir(), 'model-'));
  const env = baseEnv(url, { WHISPER_MODEL_SHA256: '0'.repeat(64) });
  assert.equal(await ensureModel({ env, modelsDir: dir, log: quiet }), 'failed');
  assert.match(download.error, /checksum/);
  assert.equal(existsSync(join(dir, 'ggml-tiny-q8_0.bin')), false);
  assert.equal(existsSync(join(dir, 'ggml-tiny-q8_0.bin.part')), false);
});

test('حافظهٔ کم: مدل دانلود نمی‌شود و تشخیص گفتار سرور خاموش است', async (t) => {
  const { srv, seen, url } = await startServer();
  t.after(() => srv.close());
  const dir = await mkdtemp(join(tmpdir(), 'model-'));
  const env = baseEnv(url, { WHISPER_MIN_MEMORY_MB: String(10_000_000) });
  assert.equal(await ensureModel({ env, modelsDir: dir, log: quiet }), 'skipped');
  assert.equal(seen.length, 0, 'درخواستی فرستاده نشد');
  assert.match(download.error, /حافظه/);

  const s = await sttStatus(await sttConfig({ WHISPER_MIN_MEMORY_MB: String(10_000_000) }));
  assert.equal(s.available, false);
  assert.match(s.disabledReason, /حافظه/);
});

test('WHISPER_MODEL_NAME=none: هیچ دانلودی نیست', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-'));
  assert.equal(await ensureModel({ env: { WHISPER_MODEL_NAME: 'none' }, modelsDir: dir, log: quiet }), 'skipped');
});

test('در کانتینر بدون دیسک (WHISPER_REQUIRE_DISK=1) مدل دانلود نمی‌شود', async (t) => {
  const { srv, seen, url } = await startServer();
  t.after(() => srv.close());
  const dir = await mkdtemp(join(tmpdir(), 'model-'));
  const env = baseEnv(url, { WHISPER_REQUIRE_DISK: '1' });
  assert.equal(await ensureModel({ env, modelsDir: dir, log: quiet }), 'skipped');
  assert.equal(seen.length, 0);
  assert.match(download.error, /دیسک/);
  // با WHISPER_AUTO_DOWNLOAD=1 صریحاً اجازه داده می‌شود
  assert.equal(await ensureModel({ env: { ...env, WHISPER_AUTO_DOWNLOAD: '1' }, modelsDir: dir, log: quiet }), 'ready');
});

test('isMountPoint: تشخیص دیسک وصل‌شده از روی mountinfo', async () => {
  const { isMountPoint } = await import('../src/model.js');
  const dir = await mkdtemp(join(tmpdir(), 'mnt-'));
  const info = join(dir, 'mountinfo');
  const real = (await import('node:fs/promises')).realpath;
  const rdir = await real(dir);
  await writeFile(info, `22 1 8:1 / / rw - ext4 /dev/sda1 rw\n99 22 8:2 / ${rdir} rw - ext4 /dev/sdb rw\n`);
  assert.equal(await isMountPoint(dir, info), true);
  assert.equal(await isMountPoint(tmpdir(), info), false);
  assert.equal(await isMountPoint(dir, join(dir, 'missing')), false);
});
