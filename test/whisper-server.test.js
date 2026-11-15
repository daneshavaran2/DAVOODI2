// whisper-server: مدل همیشه در حافظه. با یک whisper-server جعلی: راه‌اندازی، فرستادن صدا با تنظیمات درست،
// راه‌اندازی دوباره پس از از کار افتادن، رفتن به whisper-cli پس از سه بار، و جواب در همان درخواست.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'wsrv-'));
const LOG = join(dir, 'server.log');
const CLI_LOG = join(dir, 'cli.log');

// whisper-server جعلی: GET / ← 200؛ POST /inference ← متن؛ بدنهٔ درخواست در LOG
const FAKE_SERVER = `#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const a = process.argv.slice(2);
const port = Number(a[a.indexOf('--port') + 1]);
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ start: a }) + '\\n');
http.createServer((req, res) => {
  if (req.method === 'GET') return res.end('<html>whisper</html>');
  let body = '';
  req.setEncoding('latin1');
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const field = (n) => (body.match(new RegExp('name="' + n + '"\\\\r\\\\n\\\\r\\\\n([^\\\\r]*)')) || [])[1];
    fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ audio_ctx: field('audio_ctx'), beam_size: field('beam_size'), language: field('language'), hasPrompt: !!field('prompt') }) + '\\n');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ text: ' پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰\\n' }));
  });
}).listen(port, '127.0.0.1');
`;
const FAKE_CLI = `#!/usr/bin/env node
require('fs').appendFileSync(${JSON.stringify(CLI_LOG)}, 'cli\\n');
process.stdout.write(' سمند سورن\\n');
`;
const SERVER_BIN = join(dir, 'whisper-server');
const CLI_BIN = join(dir, 'whisper-cli');
const MODEL = join(dir, 'ggml-large-v3-turbo-q8_0.bin');
await writeFile(SERVER_BIN, FAKE_SERVER);
await writeFile(CLI_BIN, FAKE_CLI);
await chmod(SERVER_BIN, 0o755);
await chmod(CLI_BIN, 0o755);
await writeFile(MODEL, 'x');
Object.assign(process.env, { WHISPER_BIN: CLI_BIN, WHISPER_MODEL: MODEL, WHISPER_MIN_MEMORY_MB: '0', WHISPER_THREADS: '2' });

const stt = await import('../src/stt.js');
const quiet = () => {};

function wav(seconds) {
  const n = Math.round(seconds * 16000);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(n * 2, 40);
  return b;
}
const lines = async (f) => (await readFile(f, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);

test('whisper-server: یک بار با مدل بالا می‌آید و هر صدا با تنظیمات درست به آن فرستاده می‌شود', async () => {
  assert.equal(await stt.startPersistent(undefined, { log: quiet }), true);
  assert.equal(stt.persistentStatus().state, 'ready');
  const start = JSON.parse((await lines(LOG))[0]).start;
  assert.deepEqual(start.slice(0, 6), ['-m', MODEL, '-t', '2', '-l', 'fa']);

  const r = await stt.transcribe(wav(3));
  assert.equal(r.via, 'server');
  assert.equal(r.text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');
  const req = JSON.parse((await lines(LOG)).at(-1));
  assert.deepEqual(req, { audio_ctx: '512', beam_size: '1', language: 'fa', hasPrompt: true });
  // صدای بلندتر: پنجرهٔ بزرگ‌تر در همان درخواست
  await stt.transcribe(wav(12));
  assert.equal(JSON.parse((await lines(LOG)).at(-1)).audio_ctx, '704');
  assert.equal((await lines(CLI_LOG)).length, 0, 'whisper-cli اجرا نشد');
});

test('whisper-server از کار بیفتد: دوباره راه می‌افتد؛ سه بار در ده دقیقه: whisper-cli', async () => {
  const pid = () => stt._persistentChild()?.pid;
  for (let i = 1; i <= 3; i++) {
    const before = pid();
    process.kill(before, 'SIGKILL');
    if (i < 3) {
      // دوباره راه افتادن (۲ ثانیه بعد)
      for (let t = 0; t < 60 && !(stt.persistentStatus().state === 'ready' && pid() !== before); t++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(stt.persistentStatus().state, 'ready', `راه‌اندازی دوباره ${i}`);
    }
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(stt.persistentStatus().state, 'failed');
  const r = await stt.transcribe(wav(2));
  assert.equal(r.via, 'cli');
  assert.equal(r.text, 'سمند سورن');
});

test.after(() => stt.stopPersistent());
