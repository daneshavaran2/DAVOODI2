// فایل‌های whisper.cpp داخل مخزن باید دقیقاً همان‌هایی باشند که checksumشان ثبت شده است.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, readlinkSync } from 'node:fs';

const dir = new URL('../vendor/whisper.cpp/', import.meta.url);

test('vendor/whisper.cpp: checksumها با SHA256SUMS یکی است', () => {
  const lines = readFileSync(new URL('SHA256SUMS', dir), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 15, 'whisper-cli و همهٔ نسخه‌های CPU');
  for (const line of lines) {
    const [hash, name] = line.split(/\s+/);
    const file = new URL(`linux-x64/${name.replace(/^\.\//, '')}`, dir);
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash, name);
  }
  assert.ok(lines.some((l) => l.endsWith('/whisper-cli')));
  assert.ok(lines.some((l) => l.endsWith('/whisper-server')), 'whisper-server (مدل همیشه در حافظه)');
  assert.ok(lines.some((l) => l.endsWith('libggml-cpu-sapphirerapids.so')));
});

test('vendor/whisper.cpp: لینک‌های کتابخانه درست‌اند و برنامه اجرایی است', () => {
  const p = (n) => new URL(`linux-x64/${n}`, dir);
  assert.equal(readlinkSync(p('libwhisper.so.1')), 'libwhisper.so.1.9.5');
  assert.equal(readlinkSync(p('libggml.so.0')), 'libggml.so.0.26.0');
  assert.ok(lstatSync(p('whisper-cli')).mode & 0o111, 'whisper-cli اجرایی است');
  assert.ok(lstatSync(p('whisper-server')).mode & 0o111, 'whisper-server اجرایی است');
});
