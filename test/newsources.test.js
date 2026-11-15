// منبع‌های ایران‌جیب، car.ir، خودروبانک و خودرو۴۵: خواندن مبلغ و واحد، جدول‌ها، JSON داخل صفحه،
// تطبیق با خودروی پرسیده‌شده، و جستجوی کامل با بازار نمونه.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setFetch } from '../src/http.js';
import { createDemoFetch } from '../src/demo.js';
import { lookupAll } from '../src/lookup.js';
import { combine } from '../src/aggregate.js';
import { extractRows, matchRows, parseMoney, priceLinks, rowsFromJson, rowsFromTables } from '../src/sources/pricetable.js';
import { parseListing } from '../src/sources/khodro45.js';
import { _reset as resetHamrah } from '../src/sources/hamrah.js';
import * as iranjib from '../src/sources/iranjib.js';
import * as carir from '../src/sources/carir.js';
import * as khodrobank from '../src/sources/khodrobank.js';
import * as other from '../src/sources/baravard.js';

const M = 1e6;
const B = 1e9;

function useMarket(opts = {}) {
  resetHamrah();
  iranjib._reset();
  carir._reset();
  khodrobank._reset();
  other._reset();
  setFetch(createDemoFetch({ extra: true, ...opts }));
}

test('مبلغ: جداکننده‌ها، رقم فارسی، نوشتاری، و واحد ستون', () => {
  assert.equal(parseMoney('۱٬۲۵۰٬۰۰۰٬۰۰۰'), 1.25 * B);
  assert.equal(parseMoney('1,250,000,000 تومان'), 1.25 * B);
  assert.equal(parseMoney('1.250.000.000'), 1.25 * B);
  assert.equal(parseMoney('۱ میلیارد و ۲۵۰ میلیون تومان'), 1.25 * B);
  assert.equal(parseMoney('۸۷۵ میلیون'), 875 * M);
  // بدون واحد: از بزرگی عدد
  assert.equal(parseMoney('1,250'), 1.25 * B, 'میلیون تومان');
  assert.equal(parseMoney('1,250,000'), 1.25 * B, 'هزار تومان');
  // واحد ستون
  assert.equal(parseMoney('12,500,000,000', 'rial'), 1.25 * B);
  assert.equal(parseMoney('12,500,000,000 ریال'), 1.25 * B);
  assert.equal(parseMoney('۲٬۳۴۰', 'million'), 2.34 * B);
  assert.equal(parseMoney('1,250,000', 'thousand'), 1.25 * B);
  // نه قیمت خودرو
  assert.equal(parseMoney('-'), null);
  assert.equal(parseMoney('توقف تولید'), null);
  assert.equal(parseMoney('+۰٫۵٪'), null);
  assert.equal(parseMoney('1404'), null, 'سال، قیمت نیست');
});

test('جدول قدیمی (مثل ایران‌جیب): سطر خودروساز، سرستون بازار و نمایندگی، سطر بدون قیمت', () => {
  const html = `<h2>قیمت خودرو (تومان)</h2>
    <table class="items_table">
      <tr><th>نام خودرو</th><th>قیمت بازار</th><th>قیمت نمایندگی</th></tr>
      <tr class="catsection"><td colspan="3">ایران خودرو</td></tr>
      <tr><td class="name"><a href="/x">پژو ۲۰۶ تیپ ۲</a></td><td>۲,۳۷۰,۰۰۰,۰۰۰</td><td>۱,۴۸۵,۰۰۰,۰۰۰</td></tr>
      <tr><td>پژو ۲۰۶ تیپ ۵</td><td>2,640,000,000</td><td>-</td></tr>
      <tr><td>دنا پلاس توربو</td><td>-</td><td>-</td></tr>
      <tr class="catsection"><td colspan="3">سایپا</td></tr>
      <tr><td>شاهین G</td><td>2,220,000,000</td><td>1,550,000,000</td></tr>
    </table>`;
  const rows = rowsFromTables(html);
  assert.deepEqual(rows, [
    { group: 'ایران خودرو', name: 'پژو ۲۰۶ تیپ ۲', year: null, market: 2.37 * B, factory: 1.485 * B },
    { group: 'ایران خودرو', name: 'پژو ۲۰۶ تیپ ۵', year: null, market: 2.64 * B, factory: null },
    { group: 'سایپا', name: 'شاهین G', year: null, market: 2.22 * B, factory: 1.55 * B },
  ]);
});

test('جدول با واحد «میلیون تومان»، ستون کارخانه پیش از بازار، و ستون سال', () => {
  const html = `<table><thead><tr><th>مدل</th><th>خودرو</th><th>کارخانه (میلیون تومان)</th><th>بازار (میلیون تومان)</th></tr></thead>
    <tbody><tr><td>۱۴۰۵</td><td>سمند سورن پلاس</td><td>۱٬۹۵۰</td><td>۲٬۹۹۰</td></tr></tbody></table>`;
  assert.deepEqual(rowsFromTables(html), [{ group: '', name: 'سمند سورن پلاس', year: 1405, market: 2.99 * B, factory: 1.95 * B }]);
});

test('جدول بی‌سرستون: نام، سپس قیمت بازار و کارخانه؛ واحد ریال از متن بالای جدول', () => {
  const html = `<p>قیمت‌ها به ریال است</p><table><tr><td>کیا سراتو ۲۰۱۶</td><td>40,000,000,000</td><td>-</td></tr></table>`;
  assert.deepEqual(rowsFromTables(html), [{ group: '', name: 'کیا سراتو ۲۰۱۶', year: 2016, market: 4 * B, factory: null }]);
});

test('JSON داخل صفحه: __NEXT_DATA__ با نام خودروساز، و ld+json با قیمت ریالی', () => {
  const next = { props: { pageProps: { list: [{ brandName: 'سایپا', cars: [{ name: 'شاهین G', marketPrice: 2.2 * B, factoryPrice: '1,550,000,000' }] }] } } };
  const ld = { '@type': 'Product', name: 'پژو پارس دوگانه سوز', offers: { '@type': 'Offer', price: 29500000000, priceCurrency: 'IRR' } };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>
    <script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  assert.deepEqual(rowsFromJson(html), [
    { group: 'سایپا', name: 'شاهین G', year: null, market: 2.2 * B, factory: 1.55 * B },
    { group: '', name: 'پژو پارس دوگانه سوز', year: null, market: 2.95 * B, factory: null },
  ]);
  assert.equal(extractRows(html).length, 2);
});

test('پیوند صفحهٔ قیمت از صفحهٔ اول سایت (فقط همان سایت)', () => {
  const html = `<a href="/news">اخبار</a><a href="/car-price/">قیمت روز خودرو</a>
    <a href="https://other.ir/prices">قیمت خودرو</a><a href="https://www.khodrobank.com/car-price/">قیمت روز خودرو</a>`;
  assert.deepEqual(priceLinks(html, 'https://www.khodrobank.com/'), ['https://www.khodrobank.com/car-price/']);
});

test('تطبیق سطرها: تیپ دقیق، همهٔ تیپ‌های یک مدل، و نه مدل دقیق‌تر یا مدل دیگر', () => {
  const rows = [
    { group: 'ایران خودرو', name: 'پژو 206 تیپ 2', market: 1 },
    { group: 'ایران خودرو', name: 'پژو 206 تیپ 5', market: 2 },
    { group: 'ایران خودرو', name: 'پژو 206 SD V8', market: 3 },
    { group: 'ایران خودرو', name: 'پژو 207 اتوماتیک', market: 4 },
    { group: 'ایران خودرو', name: 'پژو 2008', market: 5 },
    { group: 'سایپا', name: 'شاهین G', market: 6 },
  ];
  const ids = (canon) => matchRows(rows, { canon }).map((r) => r.market);
  assert.deepEqual(ids({ title: 'پژو 206 تیپ 2', level: 'trim', moreSpecific: [] }), [1]);
  assert.deepEqual(ids({ title: 'پژو 206', level: 'model', moreSpecific: ['پژو 206 SD'] }), [1, 2]);
  assert.deepEqual(ids({ title: 'پژو 207', level: 'model', moreSpecific: [] }), [4]);
  assert.deepEqual(matchRows(rows, { carText: 'شاهین' }).map((r) => r.market), [6]);
});

test('خودرو۴۵: هر دو شکل پاسخ (فهرست با شیء، جزئیات با رشته)', () => {
  const listing = {
    count: 2,
    next: null,
    results: [
      {
        slug: 'ABC123', price: 1188000000, final_price: 1212000000, price_type: 2,
        car_properties: {
          brand: { title: 'پژو', title_en: 'Peugeot', seo_slug: 'peugeot' },
          model: { title: 'پارس', title_en: 'Pars', seo_slug: 'pars' },
          option: 'XU7', trim: 'ساده', year: '1402',
        },
        city: { title: 'زاهدان', title_en: 'Zahedan' },
        car_specifications: { klm: 127860 },
      },
      {
        slug: '2MAS8S', price: 2029500000, final_price: 2071500000,
        car_properties: { brand: 'چری', model: 'آریزو 5T', trim: 'اتوماتیک اکسلنت توربو', year: '۱۳۹۶' },
        city: 'مشهد',
        car_specifications: { mileage: 180775 },
      },
    ],
  };
  assert.deepEqual(parseListing(listing), [
    {
      kind: 'ad', priceKind: 'ad', id: 'abc123', title: 'پژو پارس', trim: 'ساده XU7', year: 1402, mileage: 127860,
      price: 1212000000, city: 'زاهدان', time: '', url: 'https://khodro45.com/buy-car/peugeot-pars/zahedan/cla-abc123/', isNew: false,
    },
    {
      kind: 'ad', priceKind: 'ad', id: '2mas8s', title: 'چری آریزو 5T', trim: 'اتوماتیک اکسلنت توربو', year: 1396, mileage: 180775,
      price: 2071500000, city: 'مشهد', time: '', url: null, isNew: false,
    },
  ]);
  assert.deepEqual(parseListing({}), []);
});

test('سایتی که میانه‌اش چند برابر بقیه است (واحد اشتباه) در برآورد حساب نمی‌شود', () => {
  const s = (id, median) => ({ id, name: id, basis: '', stats: { median, p25: median, p75: median, min: median, max: median, count: 1 } });
  const c = combine([s('a', 2.3 * B), s('b', 2.35 * B), s('c', 2.4 * B), s('rial', 23.5 * B)]);
  assert.deepEqual(c.sources.map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(c.estimate, 2.35 * B);
  // با دو سایت نمی‌شود گفت کدام اشتباه است
  assert.equal(combine([s('a', 2.3 * B), s('rial', 23 * B)]).sources.length, 2);
});

test('جستجوی کامل با همهٔ منبع‌ها: کارکرده (خودرو۴۵ و منبع دیگر) و صفر (جدول‌های قیمت روز)', async () => {
  useMarket();
  const used = await lookupAll('پژو 206 تیپ 2 مدل 1400');
  for (const s of used.sources) assert.ok(s.ok, `${s.id}: ${s.error}`);
  assert.deepEqual(used.summary.sources.map((s) => s.id).sort(), ['bama', 'divar', 'hamrah', 'khodro45', 'other']);
  assert.equal(used.summary.sources.find((s) => s.id === 'other').median, 1810 * M, 'میانهٔ بازهٔ ۱۷۷۰ تا ۱۸۵۰');
  assert.equal(used.summary.sources.find((s) => s.id === 'khodro45').median, 1835 * M);
  // جدول‌های قیمت روز فقط صفر کیلومتر دارند
  for (const id of ['iranjib', 'carir', 'khodrobank']) {
    const s = used.sources.find((x) => x.id === id);
    assert.equal(s.items.length, 0);
    assert.match(s.warnings.join(' '), /صفر کیلومتر/);
  }

  const zero = await lookupAll('پژو 206 تیپ 2 صفر');
  assert.equal(zero.summary.key, 'new');
  const per = Object.fromEntries(zero.summary.sources.map((s) => [s.id, s.median]));
  assert.equal(per.iranjib, 2370 * M, 'ایران‌جیب: تومان');
  assert.equal(per.carir, 2340 * M, 'car.ir: میلیون تومان با رقم فارسی');
  assert.equal(per.khodrobank, 2320 * M, 'خودروبانک: صفحهٔ قیمت از صفحهٔ اول پیدا شد، داده از __NEXT_DATA__');
  assert.equal(zero.summary.sources.length, 7);
  assert.equal(zero.summary.estimate, 2340 * M);
  // قیمت کارخانه از سه جدول (و باما)
  assert.deepEqual([...new Set(zero.factory.map((f) => f.price))], [1485 * M]);
  assert.equal(zero.factory.length, 4);
});

test('اگر یکی از سایت‌های جدید در دسترس نباشد، بقیه کار می‌کنند', async () => {
  useMarket({ fail: ['car.ir', 'khodro45.com'] });
  const r = await lookupAll('سمند سورن پلاس صفر');
  assert.equal(r.sources.find((s) => s.id === 'carir').ok, false);
  assert.equal(r.sources.find((s) => s.id === 'khodro45').ok, false);
  assert.ok(r.summary.sources.some((s) => s.id === 'iranjib'));
  assert.ok(r.summary.estimate > 2.9 * B && r.summary.estimate < 3.1 * B);
});

test('منبع دیگر: فهرست تیپ‌ها از پیوندها، و قیمت از ld+json، از بازهٔ متنی، یا از یک عدد', () => {
  const list = `<a href="/pricing/446/%D9%BE%D8%B1%D8%A7%DB%8C%D8%AF-111-%D9%87%D8%A7%DA%86-%D8%A8%DA%A9-se?model=1396">پراید 111 هاچ بک SE</a>
    <a href="https://baravard.com/pricing/310/پراید-132-se">  </a><a href="/pricing/446/x">تکراری</a><a href="/about">درباره</a>`;
  assert.deepEqual(other.catalogFromHtml(list), [
    { id: '446', slug: '%D9%BE%D8%B1%D8%A7%DB%8C%D8%AF-111-%D9%87%D8%A7%DA%86-%D8%A8%DA%A9-se', name: 'پراید 111 هاچ بک SE' },
    { id: '310', slug: 'پراید-132-se', name: 'پراید 132 se' },
  ]);

  const ld = { '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: 640000000, highPrice: 700000000 } };
  assert.deepEqual(other.parsePricingPage(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`), { low: 640 * M, high: 700 * M, price: null });
  assert.deepEqual(other.parsePricingPage('<p>قیمت تخمینی: از ۶۴۰ میلیون تا ۷۰۰ میلیون تومان</p>'), { low: 640 * M, high: 700 * M, price: null });
  assert.deepEqual(other.parsePricingPage('<p>قیمت تخمینی: ۶۴۰٬۰۰۰٬۰۰۰ تا ۷۰۰٬۰۰۰٬۰۰۰ تومان</p>'), { low: 640 * M, high: 700 * M, price: null });
  assert.deepEqual(other.parsePricingPage('<h2>قیمت روز این خودرو</h2><b>۶۷۰ میلیون تومان</b>'), { low: null, high: null, price: 670 * M });
  assert.deepEqual(other.parsePricingPage('<p>اطلاعاتی نیست</p>'), { low: null, high: null, price: null });
});

test('منبع دیگر: نام و نشانی سایت در پاسخ نمی‌آید؛ فقط با سال و برای کارکرده', async () => {
  useMarket();
  const r = await lookupAll('سمند سورن پلاس مدل 1399');
  const o = r.sources.find((s) => s.id === 'other');
  assert.equal(o.name, 'منبع دیگر');
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].price, 2170 * M);
  assert.equal(r.summary.sources.find((s) => s.id === 'other').name, 'منبع دیگر');
  assert.doesNotMatch(JSON.stringify(r), /baravard/i);

  const zero = await lookupAll('سمند سورن پلاس صفر');
  assert.equal(zero.sources.find((s) => s.id === 'other').items.length, 0);
  assert.match(zero.sources.find((s) => s.id === 'other').warnings[0], /کارکرده/);
  const noYear = await lookupAll('سمند سورن پلاس کارکرده');
  assert.match(noYear.sources.find((s) => s.id === 'other').warnings[0], /سال/);
});

test('هم‌رده‌ها: پیوندهای صفحهٔ رقبا (بدون خود خودرو)، با قیمت داخل پیوند اگر باشد', () => {
  const html = `<h1>رقبا</h1><a href="/pricing/623/self">بی ام و سری 3</a>
    <a href="/opponent/700/%D8%A8%D9%86%D8%B2-c200">بنز C200 <b>۴٫۲ میلیارد تومان</b></a>
    <a href="https://baravard.com/pricing/701/audi-a4">آئودی A4</a><a href="/pricing/701/x">تکراری</a>`;
  assert.deepEqual(other.parseOpponentPage(html, '623'), [
    { id: '700', name: 'بنز C200', price: 4.2 * B },
    { id: '701', name: 'آئودی A4', price: null },
  ]);
});

test('خودروهای هم‌رده: از صفحهٔ رقبا با قیمت صفر از جدول‌ها؛ وگرنه خودروهای هم‌قیمت', async () => {
  const { findRivals, similarPriced } = await import('../src/rivals.js');
  useMarket();
  const r = await findRivals('سمند سورن پلاس');
  assert.equal(r.basis, 'class');
  assert.equal(r.car, 'سمند سورن پلاس');
  assert.ok(r.rivals.length >= 3);
  assert.ok(r.rivals.every((x) => x.name && x.price > 1 * B), JSON.stringify(r.rivals));
  assert.ok(!r.rivals.some((x) => /سورن/.test(x.name)), 'خود خودرو نیست');
  assert.doesNotMatch(JSON.stringify(r), /baravard/i, 'نام منبع دیگر در پاسخ نیست');
  assert.ok(r.rivals.some((x) => /^پژو ۲۰۶ SD V[8۸]$/.test(x.name)), 'نام با همان شکل اصلی (حروف بزرگ لاتین)');

  useMarket({ fail: ['baravard.com'] });
  const f = await findRivals('سمند سورن پلاس');
  assert.equal(f.basis, 'price');
  assert.ok(f.rivals.length >= 1);
  assert.ok(f.rivals.every((x) => Math.abs(x.price - 3 * B) / (3 * B) <= 0.15));

  const rows = [
    { group: '', name: 'پژو 206 تیپ 2', market: 2.34 * B },
    { group: '', name: 'پژو 206 تیپ 5', market: 2.61 * B },
    { group: '', name: 'شاهین G', market: 2.2 * B },
    { group: '', name: 'سمند سورن پلاس', market: 2.3 * B },
    { group: '', name: 'هایما S7', market: 9 * B },
  ];
  assert.deepEqual(similarPriced(rows, 2.3 * B, 'سمند سورن پلاس').map((x) => x.name), ['پژو 206 تیپ 2', 'شاهین G']);
});
