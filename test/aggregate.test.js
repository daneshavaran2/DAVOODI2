import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, combine, stats } from '../src/aggregate.js';

const NOW = new Date('2026-11-14T12:00:00Z');

test('stats: حذف داده‌های پرت با IQR', () => {
  const s = stats([950e6, 1760e6, 1795e6, 1820e6, 1890e6]);
  assert.equal(s.count, 5);
  assert.equal(s.outliers, 1);
  assert.equal(s.min, 1760e6);
  assert.equal(s.median, 1807.5e6);
});

test('stats: کمتر از ۵ داده، بدون حذف', () => {
  const s = stats([100, 1000]);
  assert.equal(s.outliers, 0);
  assert.equal(s.median, 550);
  assert.equal(stats([]), null);
  assert.equal(stats([0, null, NaN]), null);
});

test('combine: میانهٔ میانه‌ها و بازه', () => {
  const c = combine([
    { id: 'a', name: 'A', basis: 'آگهی', stats: stats([10, 12, 14]) },
    { id: 'b', name: 'B', basis: 'آگهی', stats: stats([20]) },
    { id: 'c', name: 'C', basis: 'آگهی', stats: null },
  ]);
  assert.equal(c.estimate, 16);
  assert.equal(c.low, 12);
  assert.equal(c.high, 20);
  assert.equal(c.sources.length, 2);
});

const results = [
  {
    id: 'bama', name: 'باما', ok: true,
    items: [
      { kind: 'list', priceKind: 'market', isNew: true, year: 1405, price: 2350e6 },
      { kind: 'list', priceKind: 'factory', isNew: true, year: 1405, price: 1485e6, trim: 'تیپ 2' },
      { kind: 'ad', priceKind: 'ad', isNew: false, year: 1400, price: 1800e6 },
      { kind: 'ad', priceKind: 'ad', isNew: false, year: 1399, price: 1650e6 },
      { kind: 'ad', priceKind: 'ad', isNew: false, year: 1399, price: null },
    ],
  },
  { id: 'divar', name: 'دیوار', ok: false, items: [] },
  { id: 'hamrah', name: 'همراه مکانیک', ok: true, items: [{ kind: 'list', priceKind: 'market', isNew: false, year: 1400, price: 1820e6 }] },
];

test('aggregate: سال خواسته‌شده', () => {
  const a = aggregate(results, { year: { value: 1400, calendar: 'jalali' } }, NOW);
  assert.equal(a.summary.key, 1400);
  assert.equal(a.summary.estimate, 1810e6);
  assert.equal(a.summary.label, 'مدل 1400');
  assert.equal(a.factory.length, 1, 'قیمت کارخانه در برآورد نیست');
  assert.equal(a.newCar.estimate, 2350e6);
  assert.deepEqual(a.byYear.map((y) => y.key), [1400, 1399]);
});

test('aggregate: بدون سال ← صفر کیلومتر؛ «کارکرده» ← رایج‌ترین سال', () => {
  assert.equal(aggregate(results, {}, NOW).summary.key, 'new');
  const used = aggregate(results, { condition: 'used' }, NOW);
  assert.equal(used.summary.key, 1400);
  assert.match(used.summary.label, /رایج‌ترین/);
});

test('aggregate: سال جاری بدون آگهی ← قیمت صفر', () => {
  const a = aggregate(results, { year: { value: 1405, calendar: 'jalali' } }, NOW);
  assert.equal(a.summary.key, 'new');
});

test('aggregate: سال بی‌داده ← بدون جمع‌بندی', () => {
  assert.equal(aggregate(results, { year: { value: 1390, calendar: 'jalali' } }, NOW).summary, null);
});
