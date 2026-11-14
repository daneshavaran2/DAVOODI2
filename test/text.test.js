import test from 'node:test';
import assert from 'node:assert/strict';
import { extractYear, normalize, parseKm, parseQuery, parseToman, toYear, wordsToDigits } from '../src/text.js';

const NOW = new Date('2026-11-14T12:00:00Z'); // ۲۳ آبان ۱۴۰۵

test('normalize: ارقام فارسی/عربی، ي و ك عربی، نیم‌فاصله، جداکردن حرف و عدد', () => {
  assert.equal(normalize('پژو۲۰۶ تيپ ٢'), 'پژو 206 تیپ 2');
  assert.equal(normalize('دنده‌ای'), 'دنده ای');
  assert.equal(normalize('۱,۸۰۰,۰۰۰ تومان'), '1800000 تومان');
  assert.equal(normalize('L90'), 'l90');
  assert.equal(normalize('تیبا2'), 'تیبا 2');
});

test('wordsToDigits: عددهای نوشتاری فارسی', () => {
  assert.equal(wordsToDigits('پژو دویست و شش'), 'پژو 206');
  assert.equal(wordsToDigits('پراید صد و سی و یک'), 'پراید 131');
  assert.equal(wordsToDigits('پراید صد و یازده'), 'پراید 111');
  assert.equal(wordsToDigits('مدل هزار و چهارصد و دو'), 'مدل 1402');
  assert.equal(wordsToDigits('مدل نود و هشت'), 'مدل 98');
  assert.equal(wordsToDigits('پژو چهار صد و پنج'), 'پژو 405');
  assert.equal(wordsToDigits('تیپ دو'), 'تیپ 2');
  assert.equal(wordsToDigits('پژو و سمند'), 'پژو و سمند');
});

test('toYear: شکل‌های رایج گفتن سال ساخت', () => {
  assert.deepEqual(toYear('98', NOW), { value: 1398, calendar: 'jalali' });
  assert.deepEqual(toYear('02', NOW), { value: 1402, calendar: 'jalali' });
  assert.deepEqual(toYear('402', NOW), { value: 1402, calendar: 'jalali' });
  assert.deepEqual(toYear('1399', NOW), { value: 1399, calendar: 'jalali' });
  assert.deepEqual(toYear('2018', NOW), { value: 2018, calendar: 'gregorian' });
  assert.equal(toYear('30', NOW), null);
  assert.equal(toYear('206', NOW), null);
});

test('extractYear: «پژو 2008» مدل است نه سال', () => {
  assert.equal(extractYear('پژو 2008', NOW).year, null);
  assert.equal(extractYear('تویوتا کمری 2018', NOW).year.value, 2018);
  assert.equal(extractYear('پژو 206 تیپ 2 مدل 1398', NOW).year.value, 1398);
});

test('parseQuery: جمله‌های گفتاری کامل', () => {
  const a = parseQuery('قیمت پژو دویست و شش تیپ دو مدل نود و هشت چنده؟', NOW);
  assert.equal(a.carText, 'پژو 206 تیپ 2');
  assert.deepEqual(a.year, { value: 1398, calendar: 'jalali' });
  assert.equal(a.condition, null);

  const b = parseQuery('دنا پلاس صفر', NOW);
  assert.equal(b.carText, 'دنا پلاس');
  assert.equal(b.condition, 'new');

  const c = parseQuery('قیمت یک پژو ۴۰۵ کارکرده', NOW);
  assert.equal(c.carText, 'پژو 405');
  assert.equal(c.condition, 'used');

  const d = parseQuery('تیبا دو مدل صفر دو', NOW);
  assert.equal(d.carText, 'تیبا 2');
  assert.equal(d.year.value, 1402);
  assert.equal(d.condition, null, '«مدل صفر دو» یعنی ۱۴۰۲ نه صفر کیلومتر');

  const e = parseQuery('سمند ال ایکس مدل ۴۰۲', NOW);
  assert.equal(e.carText, 'سمند ال ایکس');
  assert.equal(e.year.value, 1402);
});

test('parseQuery با تکرار، حالت قبلی را نگه نمی‌دارد', () => {
  assert.equal(parseQuery('پژو 206 کارکرده', NOW).condition, 'used');
  assert.equal(parseQuery('پژو 206 کارکرده', NOW).condition, 'used');
  assert.equal(parseQuery('پژو 206', NOW).condition, null);
});

test('parseToman و parseKm', () => {
  assert.deepEqual(parseToman('۱,۸۵۰,۰۰۰,۰۰۰ تومان'), { price: 1850000000, note: null });
  assert.deepEqual(parseToman('1,800,000,000'), { price: 1800000000, note: null });
  assert.deepEqual(parseToman('۱ میلیارد و ۲۰۰ میلیون تومان'), { price: 1200000000, note: null });
  assert.deepEqual(parseToman('۹۵۰ میلیون'), { price: 950000000, note: null });
  assert.deepEqual(parseToman('توافقی'), { price: null, note: 'توافقی' });
  assert.deepEqual(parseToman('0'), { price: null, note: null });
  assert.equal(parseKm('۶۰ هزار کیلومتر'), 60000);
  assert.equal(parseKm('140,000 km'), 140000);
  assert.equal(parseKm('۹۵٬۰۰۰ کیلومتر'), 95000);
  assert.equal(parseKm('کارکرد صفر'), 0);
  assert.equal(parseKm(''), null);
});
