// فقط سال یا فقط عددی که نام مدل نیست: نام خودرو پرسیده می‌شود، نه قیمتِ آگهی‌هایی که این عدد را دارند
// («2026» قیمت ۲۱ میلیارد نشان داده بود).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/text.js';
import { setFetch } from '../src/http.js';
import { createDemoFetch } from '../src/demo.js';
import { lookupAll } from '../src/lookup.js';

test('سال میلادی تنها سال است، مگر خودش نام مدل باشد (2008)', () => {
  for (const q of ['2026', '۲۰۲۶', '2015']) {
    const p = parseQuery(q);
    assert.equal(p.carText, '', q);
    assert.equal(p.year?.value, Number(q.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))), q);
  }
  assert.equal(parseQuery('2008').carText, '2008');
  assert.equal(parseQuery('2026 لندکروزر').carText, 'لندکروزر');
  assert.equal(parseQuery('2026 لندکروزر').year.value, 2026);
});

test('جستجو: فقط سال ← «نام خودرو را هم بگویید»؛ عدد بی‌نام ← «نام خودرو نیست»؛ ۲۰۶ و ۱۳۱ مثل قبل', async () => {
  setFetch(createDemoFetch());
  for (const q of ['2026', '۲۰۲۶', 'مدل ۱۴۰۴', 'قیمت ۲۰۲۶ چنده']) {
    const r = await lookupAll(q);
    assert.match(r.error || '', /را شنیدم، ولی نام خودرو را نه/, q);
    assert.equal(r.summary, undefined);
  }
  for (const q of ['98', '25000']) assert.match((await lookupAll(q)).error || '', /نام خودرو نیست/, q);
  assert.equal((await lookupAll('206')).canonical?.title, 'پژو 206');
  assert.equal((await lookupAll('131')).canonical?.title, 'پراید 131');
});
