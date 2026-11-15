// تبدیل گفتار ابری (مثل هوش مصنوعی لیارا): با یک سرویس جعلی سازگار با OpenAI.
// اول ابری، و اگر خطا داد یا دیر کرد همان صدا با whisper خود سرور؛ کلید هیچ‌جا نشان داده نمی‌شود.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = 'sk-test-SECRET-123456';
const dir = await mkdtemp(join(tmpdir(), 'cloud-stt-'));
const CLI_LOG = join(dir, 'cli.log');
const BIN = join(dir, 'whisper-cli');
const MODEL = join(dir, 'ggml-large-v3-turbo-q8_0.bin');
await writeFile(BIN, `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(CLI_LOG)}, 'cli\\n');\nprocess.stdout.write(' سمند سورن\\n');\n`);
await chmod(BIN, 0o755);
await writeFile(MODEL, 'x');
Object.assign(process.env, { WHISPER_BIN: BIN, WHISPER_MODEL: MODEL, WHISPER_MIN_MEMORY_MB: '0', WHISPER_PERSISTENT: '0', WHISPER_THREADS: '2' });

// سرویس جعلی: رفتار با mode تعیین می‌شود؛ هر درخواست ثبت می‌شود
let mode = 'ok';
const seen = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('latin1');
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/chat/completions')) {
      const j = JSON.parse(Buffer.from(body, 'latin1').toString('utf8'));
      const audio = j.messages[1].content.find((p) => p.type === 'input_audio')?.input_audio;
      seen.push({ path: req.url, auth: req.headers.authorization, model: j.model, system: j.messages[0].content, audioFormat: audio?.format, audioBytes: audio ? Buffer.from(audio.data, 'base64').length : 0, reasoning: j.reasoning });
      if (j.model === 'no/such-model') {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { message: 'model not found' } }));
      }
      if (mode === 'no-reasoning' && j.reasoning) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: 'reasoning is not supported' } }));
      }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: mode === 'chat-silent' ? '' : '«قیمت کیا سراتو مدل ۹۸»\n' } }] }));
    }
    const field = (n) => Buffer.from((body.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1] || '', 'latin1').toString('utf8');
    seen.push({ path: req.url, auth: req.headers.authorization, model: field('model'), language: field('language'), prompt: field('prompt'), hasFile: /name="file"; filename="audio.wav"/.test(body) });
    if (mode === 'slow') return setTimeout(() => res.end('{"text":"دیر"}'), 2000);
    // مدلی مثل mai-transcribe-2: فقط file و model و language؛ هر فیلد دیگری ← 400
    if (mode === 'strict' && /name="(prompt|temperature|response_format)"/.test(body)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: prompt' } }));
    }
    if (mode === 'unauthorized') {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    }
    if (mode === 'server-error') {
      res.statusCode = 502;
      return res.end('bad gateway');
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ text: ' پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰.' }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${fake.address().port}/api/ws-123/v1`;

const { cloudConfig, cloudStatus, cleanChatText, isTranscriptionModel, _resetCloud } = await import('../src/cloudstt.js');
const stt = await import('../src/stt.js');

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
const cliRuns = async () => (await readFile(CLI_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
function useCloud(extra = {}) {
  _resetCloud();
  mode = 'ok';
  Object.assign(process.env, { STT_API_URL: BASE, STT_API_KEY: KEY, ...extra });
}
function noCloud() {
  for (const k of ['STT_API_URL', 'STT_API_KEY', 'STT_API_MODEL', 'STT_API_TIMEOUT_MS']) delete process.env[k];
  _resetCloud();
}

test('cloudConfig: نشانی لیارا، مدل پیش‌فرض، و رد نشانی بی‌کلید یا http بیرونی', () => {
  const liara = cloudConfig({ STT_API_URL: 'https://ai.liara.ir/api/abc123/v1/', STT_API_KEY: 'k' });
  assert.equal(liara.base, 'https://ai.liara.ir/api/abc123/v1');
  assert.equal(liara.model, 'openai/whisper-1');
  assert.deepEqual(liara.models, ['openai/whisper-1']);
  assert.equal(liara.host, 'ai.liara.ir');
  const full = cloudConfig({ STT_API_URL: 'https://api.example.com/v1/audio/transcriptions', STT_API_KEY: 'k', STT_API_MODEL: ' google/gemini-2.5-flash , microsoft/mai-transcribe-2 ' });
  assert.equal(full.base, 'https://api.example.com/v1');
  assert.deepEqual(full.models, ['google/gemini-2.5-flash', 'microsoft/mai-transcribe-2']);
  assert.equal(full.model, 'google/gemini-2.5-flash');
  assert.equal(isTranscriptionModel('microsoft/mai-transcribe-2'), true);
  assert.equal(isTranscriptionModel('openai/whisper-large-v3'), true);
  assert.equal(isTranscriptionModel('google/gemini-2.5-flash'), false);
  assert.equal(cloudConfig({ STT_API_URL: 'https://api.example.com/v1', STT_API_KEY: 'k' }).model, 'whisper-1');
  assert.equal(cloudConfig({ STT_API_URL: 'https://ai.liara.ir/api/abc/v1' }), null, 'بی‌کلید');
  assert.equal(cloudConfig({ STT_API_URL: 'http://ai.liara.ir/api/abc/v1', STT_API_KEY: 'k' }), null, 'http بیرونی');
  assert.equal(cloudConfig({ STT_API_URL: 'not a url', STT_API_KEY: 'k' }), null);
  assert.equal(cloudConfig({}), null);
});

test('ابری: صدا با کلید، مدل، زبان فارسی و پرامپت فرستاده می‌شود و whisper خود سرور اجرا نمی‌شود', async () => {
  useCloud();
  seen.length = 0;
  const before = await cliRuns();
  const r = await stt.transcribe(wav(3));
  assert.equal(r.via, 'cloud');
  assert.equal(r.text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {
    path: '/api/ws-123/v1/audio/transcriptions',
    auth: `Bearer ${KEY}`,
    model: 'whisper-1',
    language: 'fa',
    prompt: stt.DEFAULT_PROMPT,
    hasFile: true,
  });
  assert.equal(await cliRuns(), before, 'whisper-cli اجرا نشد');
  assert.equal(stt.recentRuns().at(-1).via, 'cloud');
  assert.ok(stt.estimateMs() !== null && stt.estimateMs() < 2000, 'زمان معمول از اجراهای ابری');
});

test('مدلی که فیلدهای اضافه را نمی‌پذیرد (400): همان صدا با فیلدهای کمتر، و دفعهٔ بعد مستقیم همان', async () => {
  useCloud({ STT_API_MODEL: 'microsoft/mai-transcribe-2' });
  mode = 'strict';
  seen.length = 0;
  const r = await stt.transcribe(wav(3));
  assert.equal(r.via, 'cloud');
  assert.equal(r.text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');
  assert.equal(seen.length, 2, 'یک بار کامل (400)، یک بار ساده');
  assert.equal(seen[1].model, 'microsoft/mai-transcribe-2');
  assert.equal(seen[1].language, 'fa');
  assert.equal(seen[1].prompt, '');
  assert.equal(cloudStatus().failed, 0, '400 اول خطا شمرده نشد');
  await stt.transcribe(wav(2));
  assert.equal(seen.length, 3, 'دفعهٔ بعد بی‌آزمون دوباره');
  delete process.env.STT_API_MODEL;
});

test('کلید نادرست: همان صدا با whisper خود سرور، و ابری تا مدتی کنار گذاشته می‌شود', async () => {
  useCloud();
  mode = 'unauthorized';
  seen.length = 0;
  const before = await cliRuns();
  const r = await stt.transcribe(wav(2));
  assert.equal(r.via, 'cli');
  assert.equal(r.text, 'سمند سورن');
  assert.equal(await cliRuns(), before + 1);
  const st = cloudStatus();
  assert.equal(st.usable, false);
  assert.match(st.lastError, /کلید سرویس ابری پذیرفته نشد \(whisper-1، HTTP 401: Invalid API key\)/);
  assert.ok(!JSON.stringify(st).includes(KEY), 'کلید در وضعیت نیست');
  // درخواست بعدی دیگر سراغ ابری نمی‌رود (منتظر خطای تکراری نمی‌ماند)
  await stt.transcribe(wav(2));
  assert.equal(seen.length, 1);
});

test('ابری دیر کند یا خطای موقت بدهد: whisper خود سرور؛ پس از دو خطای پشت‌سرهم مکث', async () => {
  useCloud({ STT_API_TIMEOUT_MS: '300' });
  mode = 'slow';
  const t0 = Date.now();
  const r = await stt.transcribe(wav(2));
  assert.equal(r.via, 'cli');
  assert.ok(Date.now() - t0 < 1800, 'بیش از مهلت منتظر ابری نماند');
  assert.match(cloudStatus().lastError, /جواب نداد/);
  assert.equal(cloudStatus().usable, true, 'یک خطا هنوز مکث نمی‌آورد');
  mode = 'server-error';
  assert.equal((await stt.transcribe(wav(2))).via, 'cli');
  assert.equal(cloudStatus().usable, false, 'دو خطای پشت‌سرهم');
  delete process.env.STT_API_TIMEOUT_MS;
});

test('سرور: فقط با ابری (بی whisper) میکروفون روشن است؛ /status و /api/health کلید را نشان نمی‌دهند', async () => {
  useCloud({ WHISPER_BIN: join(dir, 'missing-whisper') });
  const { server } = await import('../server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.stt.server, true);
    assert.match(config.stt.model, /ابری/);

    const res = await fetch(`${base}/api/transcribe?async=1&wait=5`, { method: 'POST', body: wav(3), headers: { 'content-type': 'audio/wav' } });
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.state, 'done');
    assert.equal(out.text, 'پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰');

    const health = await (await fetch(`${base}/api/health`)).text();
    const status = await (await fetch(`${base}/status`)).text();
    for (const page of [health, status, JSON.stringify(config)]) {
      assert.ok(!page.includes(KEY), 'کلید نشان داده نشد');
      assert.ok(!page.includes('ws-123'), 'نشانی کامل (شناسهٔ فضای کاری) نشان داده نشد');
    }
    assert.match(status, /تبدیل گفتار ابری/);
    assert.match(status, /روشن — 127\.0\.0\.1:\d+؛ موفق ۱/);
    assert.match(status, /whisper-1 \(تبدیل گفتار\)/);
    assert.match(status, /ابری\)/, 'اجرای ابری در فهرست تبدیل‌های اخیر');

    // ابری خطا دهد و whisper هم نباشد: خطای روشن، نه گیر کردن
    mode = 'unauthorized';
    const bad = await fetch(`${base}/api/transcribe?async=1&wait=5`, { method: 'POST', body: wav(2), headers: { 'content-type': 'audio/wav' } });
    const badOut = await bad.json();
    assert.equal(badOut.state, 'error');
    assert.match(badOut.error, /ممکن نشد/);
  } finally {
    await new Promise((r) => server.close(r));
    process.env.WHISPER_BIN = BIN;
  }
});

test('مدل گفت‌وگوی صوتی (مثل Gemini): صدا با دستور «نام خودرو» و فهرست نام‌ها، و فقط خود جمله برمی‌گردد', async () => {
  useCloud({ STT_API_MODEL: 'google/gemini-2.5-flash' });
  seen.length = 0;
  const r = await stt.transcribe(wav(3));
  assert.equal(r.via, 'cloud');
  assert.equal(r.model, 'google/gemini-2.5-flash');
  assert.equal(r.text, 'قیمت کیا سراتو مدل ۹۸', 'گیومه و خط تازه حذف شد');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/api/ws-123/v1/chat/completions');
  assert.equal(seen[0].auth, `Bearer ${KEY}`);
  assert.equal(seen[0].audioFormat, 'wav');
  assert.equal(seen[0].audioBytes, wav(3).length, 'همهٔ صدا فرستاده شد');
  assert.match(seen[0].system, /car-price app/);
  assert.match(seen[0].system, /کیا سراتو/);
  assert.deepEqual(seen[0].reasoning, { effort: 'none' });

  // سکوت: متن خالی (بدون whisper خود سرور)
  mode = 'chat-silent';
  assert.equal((await stt.transcribe(wav(2))).text, '');
  delete process.env.STT_API_MODEL;
});

test('مدل گفت‌وگو که «بدون فکر کردن» را نمی‌پذیرد: دوباره بدون آن', async () => {
  useCloud({ STT_API_MODEL: 'google/gemini-2.5-pro' });
  mode = 'no-reasoning';
  seen.length = 0;
  const r = await stt.transcribe(wav(3));
  assert.equal(r.text, 'قیمت کیا سراتو مدل ۹۸');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].reasoning, undefined);
  delete process.env.STT_API_MODEL;
});

test('چند مدل: اگر اولی نبود (404) دومی، و اولی تا مدتی کنار می‌رود', async () => {
  useCloud({ STT_API_MODEL: 'no/such-model,google/gemini-2.5-flash' });
  seen.length = 0;
  const r = await stt.transcribe(wav(3));
  assert.equal(r.via, 'cloud');
  assert.equal(r.model, 'google/gemini-2.5-flash');
  assert.deepEqual(seen.map((x) => x.model), ['no/such-model', 'google/gemini-2.5-flash']);
  const st = cloudStatus();
  assert.equal(st.models[0].skipped, true);
  assert.match(st.models[0].lastError, /نام مدل/);
  assert.equal(st.models[1].kind, 'chat');
  assert.equal(st.usable, true);
  await stt.transcribe(wav(2));
  assert.equal(seen.length, 3, 'دفعهٔ بعد مستقیم مدل دوم');
  delete process.env.STT_API_MODEL;
});

test('cleanChatText: فقط خود جمله', () => {
  assert.equal(cleanChatText('«پژو ۲۰۶ تیپ ۲»'), 'پژو ۲۰۶ تیپ ۲');
  assert.equal(cleanChatText('Transcript: "دنا پلاس مدل ۱۴۰۱"'), 'دنا پلاس مدل ۱۴۰۱');
  assert.equal(cleanChatText('```\nسمند سورن\n```'), 'سمند سورن');
  assert.equal(cleanChatText('(سکوت)'), '');
  assert.equal(cleanChatText('No speech.'), '');
  assert.equal(cleanChatText(''), '');
});

test('بی تنظیم ابری: مثل قبل فقط whisper خود سرور', async () => {
  noCloud();
  assert.equal(cloudStatus().configured, false);
  const r = await stt.transcribe(wav(2));
  assert.equal(r.via, 'cli');
});

test.after(() => {
  noCloud();
  fake.close();
});
