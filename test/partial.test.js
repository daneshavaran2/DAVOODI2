// نام ناقص خودرو (نوشتاری یا گفتاری) باید همان خودرو، همان قیمت و همان بازه را بدهد که نام کامل.
// قیمت‌های مورد انتظار با دست از test/fixtures/market.json حساب شده‌اند:
// میانهٔ هر سایت (پس از حذف داده‌های پرت) ← میانهٔ میانه‌ها؛ بازه = کمترین تا بیشترین میانه.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setFetch } from '../src/http.js';
import { createDemoFetch } from '../src/demo.js';
import { lookupAll } from '../src/lookup.js';
import { _reset as resetHamrah } from '../src/sources/hamrah.js';

const M = 1e6;

function useMarket(opts) {
  resetHamrah();
  setFetch(createDemoFetch(opts));
}

const brief = (r) => ({
  car: r.canonical?.title ?? null,
  key: r.summary?.key ?? null,
  estimate: r.summary?.estimate ?? null,
  low: r.summary?.low ?? null,
  high: r.summary?.high ?? null,
  perSource: Object.fromEntries((r.summary?.sources || []).map((s) => [s.id, s.median])),
});

// [نام کامل، شکل‌های ناقص یا گفتاری، خودروی درست، سال، برآورد، کمترین، بیشترین، میانهٔ هر سایت]
const CASES = [
  {
    full: 'پژو 206 تیپ 2 مدل 1400',
    partial: ['206 تیپ 2 مدل 1400', 'دویست و شش تیپ دو مدل هزار و چهارصد', '۲۰۶ تیپ۲ مدل ۱۴۰۰', 'پجو دویست و شش تیب دو مودل چهارصد'],
    car: 'پژو 206 تیپ 2', key: 1400,
    // باما: [۱۸۲۰، ۱۸۹۰، ۱۷۶۰، ۱۷۹۵، ۹۵۰] ← ۹۵۰ پرت است ← میانهٔ ۴ تای دیگر = ۱۸۰۷٫۵؛ دیوار: [۱۸۵۰، ۱۷۸۰، ۱۸۳۰] = ۱۸۳۰؛ همراه: ۱۸۱۰
    estimate: 1810 * M, low: 1807.5 * M, high: 1830 * M, perSource: { bama: 1807.5 * M, divar: 1830 * M, hamrah: 1810 * M },
  },
  {
    full: 'پژو 206 SD مدل 1400',
    partial: ['206 صندوقدار مدل 1400', 'دویست و شش اس دی مدل هزار و چهارصد'],
    car: 'پژو 206 SD', key: 1400,
    // باما: [۱۹۵۰، ۱۹۹۰] = ۱۹۷۰؛ دیوار: ۱۹۷۰ (آگهی‌های ۲۰۶ معمولی حساب نمی‌شوند)؛ همراه: ۱۹۶۰
    estimate: 1970 * M, low: 1960 * M, high: 1970 * M, perSource: { bama: 1970 * M, divar: 1970 * M, hamrah: 1960 * M },
  },
  {
    full: 'سمند سورن پلاس مدل 1399',
    partial: ['سورن مدل 99', 'سورن پلاس نود و نه', 'سمند سورن ۹۹'],
    car: null, key: 1399,
    // باما: [۲۱۵۰، ۲۲۰۰] = ۲۱۷۵؛ دیوار: ۲۱۸۰؛ همراه: ۲۱۷۰
    estimate: 2175 * M, low: 2170 * M, high: 2180 * M, perSource: { bama: 2175 * M, divar: 2180 * M, hamrah: 2170 * M },
  },
  {
    full: 'پژو پارس دوگانه سوز مدل 1396',
    partial: ['پارس دوگانه سوز 96', 'پرشیا دوگانه سوز مدل نود و شش'],
    car: 'پژو پارس دوگانه سوز', key: 1396,
    estimate: 1700 * M, low: 1700 * M, high: 1710 * M, perSource: { bama: 1700 * M, divar: 1700 * M, hamrah: 1710 * M },
  },
  {
    full: 'کیا سراتو مدل 2015',
    partial: ['سراتو 2015', 'سراتو مدل دو هزار و پانزده'],
    car: 'کیا سراتو', key: 2015,
    // باما: [۳۹۰۰، ۴۱۰۰، ۴۰۰۰] = ۴۰۰۰؛ دیوار: ۴۰۵۰؛ همراه: ۴۰۰۰ ← میانهٔ (۴۰۰۰، ۴۰۰۰، ۴۰۵۰)
    estimate: 4000 * M, low: 4000 * M, high: 4050 * M, perSource: { bama: 4000 * M, divar: 4050 * M, hamrah: 4000 * M },
  },
  {
    full: 'شاهین مدل 1403',
    partial: ['شاهین 1403', 'شاهین مدل هزار و چهارصد و سه', 'شاهین ۰۳'],
    car: 'شاهین', key: 1403,
    estimate: 2075 * M, low: 2060 * M, high: 2080 * M, perSource: { bama: 2075 * M, divar: 2080 * M, hamrah: 2060 * M },
  },
  {
    full: 'پراید 131 مدل 1398',
    partial: ['پراید صد و سی و یک مدل نود و هشت', 'پراید ۱۳۱ ۹۸'],
    car: 'پراید 131', key: 1398,
    // باما: [۷۴۰، ۷۵۰] = ۷۴۵؛ همراه: ۷۴۰؛ دیوار برای ۱۳۹۸ آگهی ندارد ← میانهٔ (۷۴۰، ۷۴۵) = ۷۴۲٫۵
    estimate: 742.5 * M, low: 740 * M, high: 745 * M, perSource: { bama: 745 * M, hamrah: 740 * M },
  },
];

for (const c of CASES) {
  test(`نام کامل: ${c.full} ← قیمت و بازهٔ درست`, async () => {
    useMarket();
    const r = brief(await lookupAll(c.full));
    if (c.car) assert.equal(r.car, c.car);
    assert.equal(r.key, c.key);
    assert.equal(r.estimate, c.estimate);
    assert.equal(r.low, c.low);
    assert.equal(r.high, c.high);
    assert.deepEqual(r.perSource, c.perSource);
  });

  for (const p of c.partial) {
    test(`نام ناقص «${p}» = «${c.full}»`, async () => {
      useMarket();
      const full = brief(await lookupAll(c.full));
      const part = brief(await lookupAll(p));
      assert.deepEqual(part, { ...full, car: part.car }, 'قیمت، بازه و سهم هر سایت باید یکی باشد');
      assert.equal(part.estimate, c.estimate);
    });
  }
}

test('«۲۰۶» تنها: پژو ۲۰۶، پیشنهاد تیپ و «۲۰۶ SD»؛ آگهی SD در قیمت نیست', async () => {
  useMarket();
  const r = await lookupAll('206 مدل 1400');
  assert.equal(r.canonical.title, 'پژو 206');
  assert.equal(r.canonical.level, 'model');
  const trim = r.hints.find((h) => h.kind === 'trim');
  assert.deepEqual(trim.options, ['پژو 206 تیپ 2', 'پژو 206 تیپ 5']);
  assert.deepEqual(r.hints.find((h) => h.kind === 'alt').options, ['پژو 206 SD']);
  const divar = r.sources.find((s) => s.id === 'divar');
  assert.ok(divar.items.length > 0);
  assert.ok(divar.items.every((i) => !/sd/i.test(i.title)), 'آگهی ۲۰۶ SD نباید بیاید');
  // همهٔ تیپ‌های ۲۰۶ مدل ۱۴۰۰: باما [۱۸۲۰، ۱۸۹۰، ۱۷۶۰، ۱۷۹۵، ۹۵۰، ۲۰۲۰، ۲۰۶۰]
  const bama = r.summary.sources.find((s) => s.id === 'bama');
  assert.equal(bama.count, 7);
});

test('فقط برند («پراید مدل ۹۸»): قیمت همهٔ مدل‌ها با برچسب روشن و پرسش «کدام مدل؟»', async () => {
  useMarket();
  const r = await lookupAll('پراید مدل 98');
  assert.equal(r.canonical.level, 'brand');
  assert.match(r.summary.label, /همهٔ مدل‌های پراید/);
  const h = r.hints.find((x) => x.kind === 'model');
  assert.deepEqual(h.options.sort(), ['پراید 111', 'پراید 131']);
  // باما (۱۳۱ و ۱۱۱): [۷۴۰، ۷۵۰، ۶۸۰، ۷۰۰] = ۷۲۰؛ دیوار: ۶۹۵ ← میانه = ۷۰۷٫۵
  assert.equal(r.summary.estimate, 707.5 * M);
  // زدن دکمهٔ «پراید ۱۳۱» همان قیمت نام کامل را می‌دهد
  const chosen = await lookupAll(`${h.options.find((o) => o.includes('131'))} مدل 1398`);
  assert.equal(chosen.summary.estimate, 742.5 * M);
});

test('دکمه‌های تیپ: «پژو ۲۰۶ تیپ ۵ مدل ۱۴۰۰» فقط قیمت تیپ ۵', async () => {
  useMarket();
  const r = await lookupAll('پژو 206 تیپ 5 مدل 1400');
  assert.equal(r.canonical.title, 'پژو 206 تیپ 5');
  // باما [۲۰۲۰، ۲۰۶۰] = ۲۰۴۰؛ دیوار ۲۰۵۰؛ همراه ۲۰۱۰ ← میانه ۲۰۴۰
  assert.equal(r.summary.estimate, 2040 * M);
  assert.equal(r.summary.low, 2010 * M);
  assert.equal(r.summary.high, 2050 * M);
});

test('بدون سال: صفر کیلومتر و جدول سال‌ها برای نام ناقص هم یکی است', async () => {
  useMarket();
  const a = await lookupAll('پژو 206 تیپ 2');
  const b = await lookupAll('دویست و شش تیپ دو');
  assert.equal(a.summary.key, 'new');
  // باما: بازار ۲۳۵۰ و آگهی صفر ۲۳۸۰ = ۲۳۶۵؛ دیوار ۲۳۰۰؛ همراه ۲۳۲۰ ← میانه ۲۳۲۰
  assert.equal(a.summary.estimate, 2320 * M);
  assert.deepEqual(b.summary, a.summary);
  assert.deepEqual(b.byYear.map((y) => [y.key, y.estimate]), a.byYear.map((y) => [y.key, y.estimate]));
  assert.deepEqual(a.byYear.map((y) => y.key), [1400, 1399, 1398]);
  // قیمت کارخانه جدا و در برآورد نیست
  assert.deepEqual(a.factory.map((f) => f.price), [1485 * M]);
});

test('اگر باما در دسترس نباشد، نام ناقص باز هم از دیوار و همراه مکانیک قیمت می‌گیرد', async () => {
  useMarket({ fail: ['bama.ir'] });
  const r = await lookupAll('سورن مدل 99');
  assert.equal(r.canonical, null);
  assert.deepEqual(Object.keys(brief(r).perSource).sort(), ['divar', 'hamrah']);
  // دیوار ۲۱۸۰، همراه ۲۱۷۰ ← میانه ۲۱۷۵
  assert.equal(r.summary.estimate, 2175 * M);
});

test('خودروی ناشناخته: بدون قیمت ساختگی', async () => {
  useMarket();
  const r = await lookupAll('بنز کلاس اس مدل 2020');
  assert.equal(r.summary, null);
});

test('«کارکرده»: آگهی‌های صفر کیلومتر باما در نتیجه نیستند', async () => {
  useMarket();
  const r = await lookupAll('پژو 206 تیپ 2 کارکرده مدل 1405');
  assert.equal(r.summary, null, 'برای ۱۴۰۵ آگهی کارکرده‌ای نیست؛ قیمت صفر نباید جای آن بیاید');
  const bama = r.sources.find((s) => s.id === 'bama');
  assert.ok(bama.items.every((i) => !i.isNew));
  // سال کارکرده‌ای که داده دارد همان قیمت قبلی را می‌دهد
  assert.equal((await lookupAll('پژو 206 تیپ 2 کارکرده مدل 1400')).summary.estimate, 1810 * M);
});
