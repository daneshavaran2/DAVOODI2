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

test('سال میلادی قدیمی بدون داده با قیمت صفرِ امسال پر نمی‌شود', () => {
  // فقط قیمت صفر (امسال) داریم؛ ۲۰۱۵ نباید «صفر کیلومتر» نشان داده شود، ولی ۲۰۲۶ بله
  assert.equal(aggregate(results, { year: { value: 2015, calendar: 'gregorian' } }, NOW).summary, null);
  assert.equal(aggregate(results, { year: { value: 2026, calendar: 'gregorian' } }, NOW).summary.key, 'new');
});

test('«کارکرده» با سال جاری: قیمت صفر کیلومتر جایگزین نمی‌شود', () => {
  assert.equal(aggregate(results, { year: { value: 1405, calendar: 'jalali' }, condition: 'used' }, NOW).summary, null);
});

test('قیمت غیرواقعی («۱ میلیون»، یا ۱۰ برابر دورتر از میانهٔ همین خودرو) نه نمایش داده می‌شود نه حساب', async () => {
  const { dropUnrealPrices } = await import('../src/lookup.js');
  const { aggregate } = await import('../src/aggregate.js');
  const B = 1e9;
  const ad = (year, price) => ({ kind: 'ad', priceKind: 'ad', title: 'ب ام و X6', year, price, isNew: false });
  const results = [
    // مثل گزارش کاربر: سال ۲۰۲۳ فقط یک آگهی با «۱ میلیون»
    { id: 'bama', name: 'باما', ok: true, items: [ad(2023, 1e6), ad(2013, 36 * B), ad(2012, 18.5 * B), ad(2011, 13 * B), ad(2011, 13.6 * B)], warnings: [] },
    { id: 'hamrah', name: 'همراه مکانیک', ok: true, items: [ad(2024, 11.3 * B), ad(2018, 9.2 * B), ad(2017, 8.6 * B), ad(2016, 8.3 * B), { ...ad(2016, null), note: 'توافقی' }], warnings: [] },
    { id: 'divar', name: 'دیوار', ok: true, items: [ad(2018, 9.1 * B), ad(2018, 900 * B)], warnings: [] },
    { id: 'down', name: 'خطا', ok: false, items: [], warnings: [] },
  ];
  dropUnrealPrices(results);
  const all = results.flatMap((r) => r.items.map((i) => i.price));
  assert.ok(!all.includes(1e6), '«۱ میلیون» حذف شد');
  assert.ok(!all.includes(900 * B), '۹۰۰ میلیارد (۱۰۰ برابر میانه) حذف شد');
  assert.ok(all.includes(36 * B), '۳۶ میلیارد (کمتر از ۱۰ برابر میانه) می‌ماند');
  assert.ok(all.includes(null), 'آگهی بی‌قیمت (توافقی) می‌ماند');
  assert.match(results[0].warnings[0], /^۱ قیمت غیرواقعی/);
  assert.match(results[2].warnings[0], /^۱ قیمت غیرواقعی/);
  assert.equal(results[1].warnings.length, 0);

  const agg = aggregate(results, { year: null, condition: 'used' });
  assert.ok(!agg.byYear.some((y) => y.key === 2023), 'سال ۲۰۲۳ (فقط قیمت غیرواقعی) در جدول نیست');
  assert.equal(agg.byYear.find((y) => y.key === 2018).estimate, 9.15 * B);
});
