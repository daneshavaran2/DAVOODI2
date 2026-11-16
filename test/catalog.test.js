// بانک اطلاعاتی برندها و مدل‌ها: کد مدل‌هایی که با حروف گفته می‌شوند، برندهای حرفی، رنگ‌ها و نام‌های تازه
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BRANDS, MODELS, COLORS } from '../src/data/car-catalog.js';
import { CODES, joinSpokenCodes, LETTER_BRANDS } from '../src/catalog.js';
import { parseQuery } from '../src/text.js';
import { fold } from '../src/match.js';
import { fixCarWords } from '../src/vocab.js';

test('داده: برندها، مدل‌ها و رنگ‌ها؛ بدون شمارهٔ شاسی و قیمت', async () => {
  assert.ok(BRANDS.length >= 50 && MODELS.length >= 250 && COLORS.length >= 20);
  assert.ok(BRANDS.includes('بهمن') && !BRANDS.includes('سنتینیال') && !BRANDS.includes('دیگنیتی'), 'اصلاح‌های فایل اعمال شده');
  assert.ok(MODELS.some(([b, m]) => b === 'هیوندای' && m === 'سنتنیال VS460'));
  const src = await readFile(new URL('../src/data/car-catalog.js', import.meta.url), 'utf8');
  assert.ok(!/شاسی|VIN|1022654|729349|میلیون/.test(src), 'رکوردهای خودرو در مخزن نیست');
});

test('برندهای حرفی شناخته می‌شوند', () => {
  for (const b of ['ام جی', 'ام وی ام', 'کی ام سی', 'جی ای سی', 'دی اف ام', 'بی وای دی', 'اس دبلیو ام']) assert.ok(LETTER_BRANDS.includes(b), b);
  for (const c of ['cs55', 'gs', 'x22', 't8', '320i', 'nx200t', 'hrv', 'b50f', 'y5', 'g01']) assert.ok(CODES.has(c), c);
});

const spoken = [
  ['چانگان سی اس پنجاه و پنج پلاس مدل ۱۴۰۲', 'چانگان cs55 پلاس', 1402],
  ['ام جی جی اس ۲۰۱۶', 'ام جی gs', 2016],
  ['بی ام و سیصد و بیست آی ۲۰۱۴', 'bmw 320 i', 2014],
  ['بی ام و هفتصد و سی ال آی', 'bmw 730 li'],
  ['کی ام سی تی هشت پرو', 'کی ام سی t8 پرو'],
  ['جک جی فور', 'جک j4'],
  ['جی ای سی اس پنج', 'جی ای سی s5'],
  ['هوندا اچ آر وی', 'هوندا hrv'],
  ['تویوتا سی اچ آر', 'تویوتا chr'],
  ['لکسوس آر ایکس سیصد و پنجاه', 'لکسوس rx350'],
  ['بنز ای دویست', 'بنز e200'],
  ['بنز آ صد و هشتاد', 'بنز a180'],
  ['بنز سی ال اس سیصد و پنجاه', 'بنز cls350'],
  ['ام وی ام ایکس بیست و دو پرو', 'mvm x22 پرو'],
  ['بیسترن بی پنجاه اف', 'بیسترن b50f'],
  ['دایون وای فایو', 'دایون y5'],
  ['اس دبلیو ام جی صفر یک', 'اس دبلیو ام g01'],
  ['هیوندای سوناتا وای اف', 'هیوندای سوناتا yf'],
  ['هیوندای آی بیست', 'هیوندای i20'],
  ['بهمن رسپکت مشکی متالیک', 'بهمن رسپکت'],
  ['تیگو ۷ طوسی روشن', 'تیگو 7'],
];
for (const [q, want, year] of spoken) {
  test(`«${q}» ← ${want}`, () => {
    const p = parseQuery(q);
    assert.equal(fold(p.carText), want, `carText: ${p.carText}`);
    if (year) assert.equal(p.year?.value, year);
  });
}

test('چیزهایی که نباید کد شوند', () => {
  // تیپ‌های رایج همان می‌مانند (جی ال ایکس، ای ال ایکس)؛ عدد «سی» در جمله‌های عددی عدد می‌ماند
  assert.equal(fold(parseQuery('پژو ۴۰۵ جی ال ایکس').carText), 'پژو 405 glx');
  assert.equal(fold(parseQuery('پژو پارس ای ال ایکس').carText), 'پژو پارس elx');
  assert.equal(parseQuery('پراید سی و دو هزار کارکرد').km, 32000);
  assert.equal(parseQuery('کارکرد سی هزار پراید ۱۳۱').km, 30000);
  assert.equal(parseQuery('پژو سی صد و یک').carText, 'پژو 301');
  // یک حرف تنها بدون عدد کد نیست؛ «بی رنگ» وضعیت است
  assert.deepEqual(joinSpokenCodes(['ایکس', 'تریم', 'وی', 'ایکس']), ['ایکس', 'تریم', 'vx']);
  assert.deepEqual(joinSpokenCodes(['بی', 'رنگ']), ['بی', 'رنگ']);
  assert.deepEqual(joinSpokenCodes(['قیمت', 'او', 'چنده']), ['قیمت', 'او', 'چنده']);
  assert.equal(parseQuery('تویوتا کمری بی رنگ').carText, 'تویوتا کمری');
});

test('نام‌های تازهٔ بانک اطلاعاتی در اصلاح نام نزدیک', () => {
  assert.equal(fixCarWords('بهمن رسپکد'), 'بهمن رسپکت');
  assert.equal(fixCarWords('جیلی ازکارا'), 'جیلی آزکارا');
  assert.equal(fixCarWords('نیسان قشقای'), 'نیسان قشقایی');
  assert.equal(fixCarWords('هیوندای ولستر'), 'هیوندای ولوستر');
  assert.equal(fixCarWords('تیگو ۷ ایرانی'), 'تیگو ۷ ایرانی', 'کلمهٔ عمومی «ایران» جای «ایرانی» را نمی‌گیرد');
});
