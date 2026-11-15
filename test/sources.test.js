import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAds, parsePriceList } from '../src/sources/bama.js';
import { parseRows } from '../src/sources/divar.js';
import { catalogFromBrandPage, catalogFromPriceLists, filterTrims, parseModelPage } from '../src/sources/hamrah.js';
import { tokens } from '../src/match.js';

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

test('باما: آگهی‌ها؛ اقساطی و حواله قیمت ندارند، کارکرد صفر = نو', () => {
  const ads = parseAds(fx('bama-search.json'));
  assert.equal(ads.length, 13);
  const a1 = ads[0];
  assert.equal(a1.price, 1820000000);
  assert.equal(a1.year, 1400);
  assert.equal(a1.mileage, 98000);
  assert.equal(a1.title, 'پژو 206');
  assert.match(a1.url, /^https:\/\/bama\.ir\/car\/detail-a1-/);
  const inst = ads.find((a) => a.note === 'اقساطی');
  assert.equal(inst.price, null);
  const hav = ads.find((a) => a.note === 'حواله');
  assert.equal(hav.price, null);
  assert.ok(ads.find((a) => a.mileage === 0 && a.price).isNew);
});

test('باما: فهرست قیمت صفر، قیمت کارخانه جدا', () => {
  const rows = parsePriceList(fx('bama-price.json'));
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => r.priceKind === 'factory').length, 2);
  assert.equal(rows[0].priceKind, 'market');
  assert.equal(rows[0].year, 1405);
  assert.ok(rows.every((r) => r.isNew));
});

test('دیوار: قیمت، کارکرد و سال از عنوان', () => {
  const rows = parseRows(fx('divar-search.json'));
  assert.equal(rows.length, 11);
  const r = rows[0];
  assert.equal(r.price, 1850000000);
  assert.equal(r.mileage, 60000);
  assert.equal(r.year, 1400);
  assert.equal(r.url, 'https://divar.ir/v/dA1');
  assert.equal(r.city, 'تهران / پونک');
  assert.equal(r.time, 'دقایقی پیش');
  assert.equal(rows.find((x) => x.token === 'dA7').note, 'توافقی');
  assert.ok(rows.find((x) => x.token === 'dA6').isNew);
});

test('همراه مکانیک: فهرست مدل‌ها و صفحهٔ مدل', () => {
  const cat = catalogFromPriceLists(fx('hamrah-dakheli.json').pageProps, fx('hamrah-khareji.json').pageProps);
  assert.deepEqual(cat[0], { brand: 'irankhodro', model: 'peugeot206', name: 'پژو 206' });
  assert.ok(cat.some((m) => m.brand === 'toyota' && m.model === 'camry'));

  const brand = catalogFromBrandPage(fx('hamrah-saipa.json').pageProps, 'saipa');
  assert.deepEqual(brand[0], { brand: 'saipa', model: 'pride131', name: 'پراید 131' });

  const page = parseModelPage(fx('hamrah-model-206.json').pageProps);
  assert.equal(page.title, 'پژو 206');
  assert.equal(page.rows.length, 10);
  assert.equal(page.rows.filter((r) => r.isNew).length, 2);
  assert.ok(page.rows.filter((r) => r.year === 1400).every((r) => !r.isNew));
});

test('همراه مکانیک: صافی تیپ', () => {
  const { rows } = parseModelPage(fx('hamrah-model-206.json').pageProps);
  const t2 = filterTrims(rows, tokens('پژو 206 تیپ 2'), 'پژو 206');
  assert.equal(t2.trimMatched, true);
  assert.ok(t2.rows.every((r) => r.trim === 'تیپ 2'));
  const all = filterTrims(rows, tokens('پژو 206'), 'پژو 206');
  assert.equal(all.rows.length, rows.length);
  const none = filterTrims(rows, tokens('پژو 206 اتوماتیک'), 'پژو 206');
  assert.equal(none.trimMatched, false);
  assert.equal(none.rows.length, rows.length);
});
