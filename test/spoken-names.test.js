// نام‌هایی که با حروف یا عدد انگلیسی گفته می‌شوند («بی ام و ایکس وان»، «جک اس فایو»، «بنز سی ۲۰۰») و جمله‌هایی
// که کارکرد، رنگ و سال میلادی دارند: خودروی درست پیدا شود، نه خودرویی که فقط در یک حرف («ام») شریک است.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/text.js';
import { resolveVehicle } from '../src/sources/bama.js';

// فهرست خودروها به شکل باما (عنوان فارسی، مدل‌های لاتین، برند با نیم‌فاصله)
const V = (value, title, keywords = '') => ({ value, title, keywords });
const vehicles = [
  V('bmw', 'بی‌ام‌و', 'بی ام و bmw'),
  V('bmw,x1', 'بی‌ام‌و X1', 'bmw x1'),
  V('bmw,x3', 'بی‌ام‌و X3', 'bmw x3'),
  V('bmw,3series', 'بی‌ام‌و سری 3', 'bmw 3 series'),
  V('mg', 'ام‌جی', 'ام جی mg'),
  V('mg,4ev', 'ام‌جی 4EV 150 کیلو وات', 'mg 4ev'),
  V('mg,zs', 'ام‌جی ZS', 'mg zs'),
  V('mvm', 'ام‌وی‌ام', 'mvm'),
  V('mvm,x22', 'ام‌وی‌ام X22', 'mvm x22'),
  V('jac', 'جک', 'jac'),
  V('jac,s5', 'جک S5', 'jac s5'),
  V('jac,j4', 'جک J4', 'jac j4'),
  V('benz', 'بنز', 'mercedes benz مرسدس'),
  V('benz,c200', 'بنز C200', 'benz c200'),
  V('benz,e350', 'بنز E350', 'benz e350'),
  V('citroen', 'سیتروئن', 'citroen'),
  V('citroen,c3', 'سیتروئن C3', 'citroen c3'),
  V('chery', 'چری', 'chery'),
  V('chery,tiggo7pro', 'چری تیگو 7 پرو', 'tiggo 7 pro'),
  V('chery,tiggo8', 'چری تیگو 8', 'tiggo 8'),
  V('peugeot', 'پژو', 'peugeot'),
  V('peugeot,206ir', 'پژو 206', 'peugeot 206'),
  V('peugeot,2008', 'پژو 2008', 'peugeot 2008'),
  V('changan', 'چانگان', 'changan'),
  V('changan,cs35', 'چانگان CS35', 'cs35'),
  V('changan,cs55', 'چانگان CS55', 'cs55'),
  V('changan,cs55plus', 'چانگان CS55 پلاس', 'cs55 plus'),
  V('kmc', 'کی‌ام‌سی', 'kmc'),
  V('kmc,t8', 'کی‌ام‌سی T8', 'kmc t8'),
  V('kmc,j7', 'کی‌ام‌سی J7', 'kmc j7'),
  V('honda', 'هوندا', 'honda'),
  V('honda,hrv', 'هوندا HR-V', 'hr-v'),
  V('bahman', 'بهمن', 'bahman'),
  V('bahman,respect', 'بهمن رسپکت', 'respect'),
];

const cases = [
  ['بی ام و ایکس وان ۲۰۱۵ بدون رنگ کارکرد ۱۰۰ هزار', 'bmw,x1', { year: 2015, km: 100000 }],
  ['بی ام و x1 مدل ۲۰۱۵', 'bmw,x1', { year: 2015 }],
  ['قیمت بی‌ام‌و ایکس یک', 'bmw,x1'],
  ['بی ام دبلیو ایکس تری', 'bmw,x3'],
  ['ام جی زد اس', 'mg'],
  ['ام جی فور ای وی', 'mg'],
  ['ام وی ام ایکس ۲۲', 'mvm,x22'],
  ['جک اس فایو ۱۴۰۲ سفید', 'jac,s5', { year: 1402 }],
  ['بنز سی ۲۰۰ مدل ۲۰۱۸ مشکی', 'benz,c200', { year: 2018 }],
  ['بنز سی دویست', 'benz,c200'],
  ['سیتروئن سی سه', 'citroen,c3'],
  ['تیگو سون پرو مدل ۱۴۰۲', 'chery,tiggo7pro', { year: 1402 }],
  ['پژو ۲۰۰۸', 'peugeot,2008', { year: null }],
  ['پژو ۲۰۶ مدل ۹۸ کارکرد ۵۰ هزار کیلومتر دو لکه رنگ', 'peugeot,206ir', { year: 1398, km: 50000 }],
  // نام‌ها و کدهای بانک اطلاعاتی
  ['چانگان سی اس پنجاه و پنج پلاس ۱۴۰۲', 'changan,cs55plus', { year: 1402 }],
  ['سی اس سی و پنج', 'changan,cs35'],
  ['کی ام سی تی هشت', 'kmc,t8'],
  ['کی ام سی جی هفت مشکی متالیک', 'kmc,j7'],
  ['هوندا اچ آر وی ۲۰۱۸', 'honda,hrv', { year: 2018 }],
  ['بهمن رسپکد', 'bahman,respect'],
];

for (const [q, want, extra = {}] of cases) {
  test(`«${q}» ← ${want}`, () => {
    const p = parseQuery(q);
    const v = resolveVehicle(vehicles, p.carText);
    assert.ok(v, `پیدا نشد (carText: ${p.carText})`);
    assert.ok(v.value === want || (want.split(',').length === 1 && v.value.startsWith(`${want},`)), `${v.value} به جای ${want} (carText: ${p.carText})`);
    if ('year' in extra) assert.equal(p.year?.value ?? null, extra.year);
    if ('km' in extra) assert.equal(p.km, extra.km);
  });
}

test('کارکرد و رنگ جزو نام خودرو نیستند؛ «۱۵۰ کیلو وات» کارکرد نیست', () => {
  assert.equal(parseQuery('تویوتا کمری 2015 بی رنگ').carText, 'تویوتا کمری');
  assert.equal(parseQuery('هیوندای توسان ۲۰۱۷ مشکی').carText, 'هیوندای توسان');
  assert.equal(parseQuery('پراید ۱۳۱ کارکرد صد و بیست هزار').km, 120000);
  const mg = parseQuery('ام جی ۴ ۱۵۰ کیلو وات');
  assert.equal(mg.km, null);
  assert.match(mg.carText, /150 کیلو وات/);
});
