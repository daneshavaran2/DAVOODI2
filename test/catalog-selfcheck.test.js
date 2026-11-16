// هر مدل بانک اطلاعاتی، گفته‌شده با برند (و بدون برند اگر نامش یکتاست)، باید خودش را پیدا کند، نه مدل شبیه دیگری
// (لندکروزر ≠ لندرور، X 22 ≠ X22 پرو، «سی لاین» ≠ «i 30»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../src/data/car-catalog.js';
import { parseQuery } from '../src/text.js';
import { pickBest, tokens } from '../src/match.js';

// یک کد زیر دو برند در خود فایل (دی اف ام / دانگ فنگ H30، کی ام سی K5 / کیا اپتیما K5): ابهام واقعی
const AMBIGUOUS = new Set(['H30', 'K5']);

test('همهٔ مدل‌های بانک اطلاعاتی خودشان را پیدا می‌کنند', () => {
  const items = [...new Set(MODELS.map(([b]) => b))]
    .map((b) => ({ title: b }))
    .concat(MODELS.map(([b, m]) => ({ title: `${b} ${m}` })));
  const key = (t) => tokens(t).join(' ');
  const count = new Map();
  for (const [, m] of MODELS) count.set(key(m), (count.get(key(m)) || 0) + 1);
  const bad = [];
  for (const [b, m] of MODELS) {
    for (const q of [`${b} ${m}`, count.get(key(m)) === 1 && !AMBIGUOUS.has(m) ? m : null]) {
      if (!q) continue;
      const top = pickBest(parseQuery(q).carText, items, (v) => v.title);
      if (!top || key(top.item.title) !== key(`${b} ${m}`)) bad.push(`${q} ← ${top?.item.title ?? '-'}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('لندکروزر لندرور نیست (سایت یک‌کلمه یا دوکلمه بنویسد، کاربر یک‌کلمه یا دوکلمه بگوید)', () => {
  for (const lc of ['تویوتا لند کروزر', 'تویوتا لندکروزر']) {
    const items = ['لندرور', 'لندرور رنجرور', 'تویوتا', lc, 'تویوتا کمری'].map((title) => ({ title }));
    for (const [q, want] of [['لندکروزر ۲۰۲۶', lc], ['لند کروزر', lc], ['لند کروز ۸ سیلندر', lc], ['تویوتا لند', lc], ['لندرور', 'لندرور'], ['رنجرور', 'لندرور رنجرور']]) {
      assert.equal(pickBest(parseQuery(q).carText, items, (v) => v.title)?.item.title, want, `سایت «${lc}»، گفته «${q}»`);
    }
  }
});
