// آزمون پس‌رفت: خروجی واقعی Whisper (large-v3-turbo-q8_0) روی جمله‌های گفتاری؛
// تجزیه‌گر باید دست‌کم همین تعداد را درست بفهمد.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseQuery } from '../src/text.js';
import { cleanTranscript } from '../src/stt.js';
import { tokens, tokenSim } from '../src/match.js';

const { items } = JSON.parse(readFileSync(new URL('./fixtures/whisper-transcripts.json', import.meta.url)));
const NOW = new Date('2026-11-14T12:00:00Z');

function understood(it) {
  const q = parseQuery(cleanTranscript(it.whisper), NOW);
  const yearOk = (q.year?.value ?? null) === it.year;
  const got = tokens(q.carText);
  const carOk = tokens(it.car).every((w) => got.some((g) => tokenSim(w, g) >= 0.7));
  return { yearOk, carOk, ok: yearOk && carOk };
}

test('خروجی واقعی Whisper: نام خودرو و سال', () => {
  const r = items.map(understood);
  const ok = r.filter((x) => x.ok).length;
  const years = r.filter((x) => x.yearOk).length;
  assert.ok(ok >= 16, `${ok}/${items.length} درست فهمیده شد (انتظار دست‌کم ۱۶)`);
  assert.ok(years >= 24, `${years}/${items.length} سال درست (انتظار دست‌کم ۲۴)`);
});
