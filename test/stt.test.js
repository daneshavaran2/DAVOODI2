// آزمون تشخیص گفتار روی سرور با یک whisper-cli جعلی (همان رابط خط فرمان، بدون مدل واقعی).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanTranscript, parseWav, sttConfig, sttStatus, transcribe, DEFAULT_PROMPT } from '../src/stt.js';

function makeWav(seconds, { rate = 16000, channels = 1, bits = 16 } = {}) {
  const samples = Math.round(seconds * rate) * channels;
  const bytes = samples * (bits / 8);
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * (bits / 8), 28);
  b.writeUInt16LE(channels * (bits / 8), 32);
  b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(bytes, 40);
  return b;
}

// whisper-cli جعلی: آرگومان‌ها را ثبت می‌کند و متن FAKE_TEXT را مثل whisper-cli -nt -np چاپ می‌کند
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args: a, wavExists: fs.existsSync(val('-f')) }) + '\\n');
const out = () => {
  if (process.env.FAKE_EXIT) { process.stderr.write('error: failed to read model\\n'); process.exit(Number(process.env.FAKE_EXIT)); }
  process.stdout.write(process.env.FAKE_TEXT ?? ' پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰\\n');
};
const ms = Number(process.env.FAKE_SLEEP || 0);
ms ? setTimeout(out, ms) : out();
`;

const dir = await mkdtemp(join(tmpdir(), 'stt-test-'));
const BIN = join(dir, 'whisper-cli');
const MODEL = join(dir, 'ggml-small.bin');
const LOG = join(dir, 'log.jsonl');
await writeFile(BIN, FAKE);
await chmod(BIN, 0o755);
await writeFile(MODEL, 'not a real model');

const cfg = (over = {}) => sttConfig({ WHISPER_BIN: BIN, WHISPER_MODEL: MODEL, WHISPER_THREADS: '2', ...over });

function resetFake() {
  for (const k of ['FAKE_TEXT', 'FAKE_EXIT', 'FAKE_SLEEP']) delete process.env[k];
  process.env.FAKE_LOG = LOG;
}

test('parseWav: فقط WAV ۱۶kHz تک‌کاناله ۱۶ بیتی', () => {
  const w = parseWav(makeWav(2));
  assert.equal(w.sampleRate, 16000);
  assert.equal(w.channels, 1);
  assert.equal(w.seconds, 2);
  assert.throws(() => parseWav(Buffer.from('hello world, this is not a wav file at all......')), /WAV/);
  assert.throws(() => parseWav(makeWav(1, { channels: 2 })), /تک‌کاناله/);
  assert.throws(() => parseWav(makeWav(1, { rate: 44100 })), /۱۶ کیلوهرتز/);
  assert.throws(() => parseWav(makeWav(1, { bits: 8 })), /۱۶ بیتی/);
  assert.throws(() => parseWav(Buffer.alloc(10)), /خالی|ناقص/);
});

test('cleanTranscript: حذف برچسب‌ها و متن‌های ساختگی Whisper', () => {
  assert.equal(cleanTranscript(' پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰.\n'), 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');
  assert.equal(cleanTranscript('[BLANK_AUDIO]'), '');
  assert.equal(cleanTranscript('(موسیقی) پراید ۱۳۱'), 'پراید ۱۳۱');
  assert.equal(cleanTranscript('زیرنویس توسط امیر'), '');
  assert.equal(cleanTranscript('Thank you.'), '');
  assert.equal(cleanTranscript('سمند، دنا، تیبا، ساینا، کوییک، شاهین', DEFAULT_PROMPT), '', 'تکرار پرامپت');
  assert.equal(cleanTranscript('دنا پلاس', DEFAULT_PROMPT), 'دنا پلاس', 'جملهٔ کوتاه واقعی حذف نمی‌شود');
});

test('sttStatus: وقتی whisper نصب نیست', async () => {
  const s = await sttStatus(await sttConfig({ WHISPER_BIN: join(dir, 'nope'), WHISPER_MODEL: MODEL }));
  assert.equal(s.available, false);
  assert.equal((await sttStatus(await cfg())).available, true);
});

test('transcribe: آرگومان‌های whisper-cli، متن تمیز و پاک شدن فایل موقت', async () => {
  resetFake();
  await writeFile(LOG, '');
  const r = await transcribe(makeWav(1.5), await cfg());
  assert.equal(r.text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');
  assert.equal(r.seconds, 1.5);
  const call = JSON.parse((await readFile(LOG, 'utf8')).trim().split('\n').pop());
  const a = call.args;
  assert.equal(a[a.indexOf('-l') + 1], 'fa');
  assert.equal(a[a.indexOf('-m') + 1], MODEL);
  assert.equal(a[a.indexOf('-t') + 1], '2');
  assert.ok(a.includes('-nt') && a.includes('-np'));
  assert.match(a[a.indexOf('--prompt') + 1], /پراید/);
  assert.ok(call.wavExists, 'فایل WAV هنگام اجرا وجود داشت');
  assert.equal(existsSync(a[a.indexOf('-f') + 1]), false, 'فایل موقت پاک شد');
});

test('transcribe: خطای whisper و صدای خیلی کوتاه یا بلند', async () => {
  resetFake();
  process.env.FAKE_EXIT = '3';
  await assert.rejects(transcribe(makeWav(1), await cfg()), (e) => e.status === 500 && /failed to read model/.test(e.message));
  resetFake();
  await assert.rejects(transcribe(makeWav(0.1), await cfg()), (e) => e.status === 400);
  await assert.rejects(transcribe(makeWav(31), await cfg()), (e) => e.status === 400);
  await assert.rejects(
    transcribe(makeWav(1), await cfg({ WHISPER_BIN: join(dir, 'missing') })),
    (e) => e.status === 503,
  );
});

test('transcribe: مهلت زمانی', async () => {
  resetFake();
  process.env.FAKE_SLEEP = '3000';
  const t0 = Date.now();
  await assert.rejects(transcribe(makeWav(1), await cfg({ WHISPER_TIMEOUT_MS: '300' })), (e) => e.status === 504);
  assert.ok(Date.now() - t0 < 2000);
});

test('transcribe: صف — هم‌زمان فقط یک اجرا', async () => {
  resetFake();
  process.env.FAKE_SLEEP = '300';
  const c = await cfg({ WHISPER_CONCURRENCY: '1' });
  const t0 = Date.now();
  const rs = await Promise.all([transcribe(makeWav(1), c), transcribe(makeWav(1), c)]);
  assert.ok(Date.now() - t0 >= 600, 'دو اجرا پشت سر هم');
  assert.ok(rs.every((r) => r.text));
});

test('API: POST /api/transcribe و /api/config', async (t) => {
  resetFake();
  process.env.WHISPER_BIN = BIN;
  process.env.WHISPER_MODEL = MODEL;
  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const cfgRes = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfgRes.stt.server, true);
  assert.equal(cfgRes.stt.model, 'ggml-small.bin');

  const ok = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: makeWav(1.2) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');

  assert.equal((await fetch(`${base}/api/transcribe`)).status, 405);
  const bad = await fetch(`${base}/api/transcribe`, { method: 'POST', body: Buffer.from('x'.repeat(100)) });
  assert.equal(bad.status, 400);
  const big = await fetch(`${base}/api/transcribe`, { method: 'POST', body: makeWav(40) }).catch(() => null);
  assert.ok(!big || big.status === 413);
});

test('API: تبدیل جداگانه (async): شمارهٔ کار فوراً، سپس پرسیدن تا آماده شود؛ و سهم پردازنده در health', async (t) => {
  resetFake();
  process.env.WHISPER_BIN = BIN;
  process.env.WHISPER_MODEL = MODEL;
  process.env.FAKE_SLEEP = '700'; // whisper کند
  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    delete process.env.FAKE_SLEEP;
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const t0 = Date.now();
  const start = await fetch(`${base}/api/transcribe?async=1`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: makeWav(1.5) });
  assert.equal(start.status, 202);
  const job = await start.json();
  assert.ok(Date.now() - t0 < 500, 'پاسخ فوری، پیش از پایان whisper');
  assert.ok(job.job && ['queued', 'running'].includes(job.state));

  let r = job;
  while (r.state !== 'done' && r.state !== 'error') {
    await new Promise((res) => setTimeout(res, 150));
    r = await (await fetch(`${base}/api/transcribe?job=${job.job}`)).json();
  }
  assert.equal(r.state, 'done');
  assert.equal(r.text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');
  assert.ok(r.ms >= 700, 'زمان همین تبدیل');
  assert.ok(r.estimateMs > 0, 'زمان تخمینی از اجراهای اخیر');

  // با wait: سرور منتظر می‌ماند و متن در همان درخواست می‌آید
  const direct = await fetch(`${base}/api/transcribe?async=1&wait=5`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: makeWav(1.5) });
  assert.equal(direct.status, 200);
  const d = await direct.json();
  assert.equal(d.state, 'done');
  assert.equal(d.text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');

  assert.equal((await fetch(`${base}/api/transcribe?job=nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/transcribe?async=1`, { method: 'POST', body: Buffer.from('x'.repeat(100)) })).status, 400);

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.ok(health.stt.threads >= 1 && health.stt.cpu > 0);
  assert.ok(health.stt.recent.length >= 1);
});

test('dedupeRepeats: تکرار جمله (خطای رایج Whisper)', async () => {
  const { dedupeRepeats } = await import('../src/stt.js');
  assert.equal(dedupeRepeats('رانا پلاس مدل 1400 رانا پلاس مدل 1400'), 'رانا پلاس مدل 1400');
  assert.equal(dedupeRepeats('سمند ال ایکس، مدل 1402 سمند ال ایکس، مدل 1402 سمند ال ایکس،'), 'سمند ال ایکس، مدل 1402');
  assert.equal(dedupeRepeats('پژو 206 تیپ 2'), 'پژو 206 تیپ 2');
  assert.equal(cleanTranscript('آیما اس حف، آیما اس حف،'), 'آیما اس حف');
});

test('audioCtxArgs: پنجرهٔ صوتی به اندازهٔ صدا (کمتر از ۱۰ ثانیه: ۵۱۲؛ ۳۰ ثانیه: کامل)', async () => {
  const { audioCtxArgs } = await import('../src/stt.js');
  const auto = await sttConfig({});
  assert.deepEqual(audioCtxArgs(auto, 3), ['-ac', '512']);
  assert.deepEqual(audioCtxArgs(auto, 9), ['-ac', '512']);
  assert.deepEqual(audioCtxArgs(auto, 12), ['-ac', '704'], '۱۳ ثانیه پنجره');
  assert.deepEqual(audioCtxArgs(auto, 29.5), []);
  assert.deepEqual(audioCtxArgs(await sttConfig({ WHISPER_AUDIO_CTX: '0' }), 3), []);
  assert.deepEqual(audioCtxArgs(await sttConfig({ WHISPER_AUDIO_CTX: '768' }), 20), ['-ac', '768']);
});

test('whisper با «Illegal instruction»: تشخیص گفتار سرور خاموش می‌شود (به جای خطا در هر درخواست)', async () => {
  const { _resetDisabled } = await import('../src/stt.js');
  const sigill = join(dir, 'whisper-sigill');
  await writeFile(sigill, "#!/usr/bin/env node\nprocess.kill(process.pid, 'SIGILL');\n");
  await chmod(sigill, 0o755);
  const c = await sttConfig({ WHISPER_BIN: sigill, WHISPER_MODEL: MODEL });
  await assert.rejects(transcribe(makeWav(1), c), (e) => e.status === 503 && /Illegal instruction/.test(e.message));
  assert.equal((await sttStatus(c)).available, false);
  assert.match((await sttStatus(c)).disabledReason, /Illegal instruction/);
  _resetDisabled();
  assert.equal((await sttStatus(c)).available, true);
});
