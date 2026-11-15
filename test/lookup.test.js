// آزمون کل مسیر (پرسش ← سه سایت ← جمع‌بندی ← API) با fetch جعلی و داده‌های نمونه.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setFetch } from '../src/http.js';
import { createDemoFetch } from '../src/demo.js';
import { lookupAll } from '../src/lookup.js';
import { _reset as resetHamrah } from '../src/sources/hamrah.js';
import { server } from '../server.js';

function useFetch(opts) {
  resetHamrah();
  setFetch(createDemoFetch(opts));
}

test('پرسش گفتاری کامل: هر سه سایت پاسخ می‌دهند', async () => {
  useFetch();
  const r = await lookupAll('قیمت پژو دویست و شش تیپ دو مدل هزار و چهارصد');
  assert.equal(r.query.carText, 'پژو 206 تیپ 2');
  assert.equal(r.query.year.value, 1400);
  // بازار نمونهٔ پیش‌فرض فقط سه سایت اصلی را دارد (منبع‌های دیگر در test/newsources.test.js)
  for (const s of r.sources.filter((x) => ['bama', 'divar', 'hamrah'].includes(x.id))) assert.ok(s.ok, `${s.id}: ${s.error}`);
  assert.equal(r.sources.find((s) => s.id === 'bama').matched.id, 'peugeot,206ir,type2');
  assert.equal(r.sources.find((s) => s.id === 'hamrah').matched.id, 'irankhodro/peugeot206');
  // دیوار: فقط تیپ ۲ مدل ۱۴۰۰ با قیمت؛ ۲۰۷، تیپ ۵، خریدار و رینگ حذف شده‌اند
  const divar = r.sources.find((s) => s.id === 'divar');
  assert.ok(divar.items.length >= 3);
  assert.ok(divar.items.every((i) => i.year === 1400 && /تیپ ۲/.test(i.title)));

  assert.equal(r.summary.key, 1400);
  assert.equal(r.summary.sources.length, 3);
  assert.ok(r.summary.estimate > 1.7e9 && r.summary.estimate < 1.9e9);
});

test('بدون سال: قیمت صفر و جدول سال‌ها', async () => {
  useFetch();
  const r = await lookupAll('پژو ۲۰۶');
  assert.equal(r.summary.key, 'new');
  assert.ok(r.byYear.length >= 3);
  assert.ok(r.byYear[0].key > r.byYear.at(-1).key);
  assert.ok(r.factory.length >= 1);
});

test('مدل قدیمی (پراید) از صفحهٔ برند همراه مکانیک پیدا می‌شود', async () => {
  useFetch();
  const r = await lookupAll('پراید صد و سی و یک مدل نود و هشت');
  const h = r.sources.find((s) => s.id === 'hamrah');
  assert.equal(h.matched.id, 'saipa/pride131');
  assert.equal(r.summary.estimate, 742.5e6, 'میانهٔ باما (۷۴۵) و همراه مکانیک (۷۴۰)');
});

test('اگر یک سایت در دسترس نباشد، بقیه نتیجه می‌دهند', async () => {
  useFetch({ fail: ['api.divar.ir'] });
  const r = await lookupAll('پژو 206 تیپ 2 مدل 1400');
  const divar = r.sources.find((s) => s.id === 'divar');
  assert.equal(divar.ok, false);
  assert.match(divar.error, /api\.divar\.ir/);
  assert.ok(r.summary);
  assert.equal(r.summary.sources.length, 2);
});

test('همهٔ سایت‌ها در دسترس نباشند: خطای روشن، بدون کرش', async () => {
  useFetch({ fail: ['bama.ir', 'api.divar.ir', 'www.hamrah-mechanic.com'] });
  const r = await lookupAll('پژو 206');
  assert.equal(r.summary, null);
  // هر منبع یا خطا داده یا (مثل منبعی که بدون سال اصلاً درخواستی نمی‌فرستد) قیمتی نداده است
  for (const s of r.sources) assert.ok((!s.ok && s.error) || !s.items.length, s.id);
  for (const id of ['bama', 'divar', 'hamrah']) assert.equal(r.sources.find((s) => s.id === id).ok, false);
});

test('متن بی‌معنی: پیام راهنما', async () => {
  useFetch();
  const r = await lookupAll('قیمت چنده؟');
  assert.match(r.error, /نام خودرو/);
});

test('API سرور: /api/price و /api/config و فایل‌های ایستا', async (t) => {
  useFetch();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  // fetch اصلی برای صدا زدن سرور خودمان؛ سرور از fetch جعلی برای سایت‌ها استفاده می‌کند
  const res = await fetch(`${base}/api/price?q=${encodeURIComponent('پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰')}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.summary.key, 1400);

  assert.equal((await fetch(`${base}/api/price?q=`)).status, 400);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.cities['1'], 'تهران');
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /دستیار هوشمند خودرو داوودی/);
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);
});
