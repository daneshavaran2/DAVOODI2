// واژه‌های خودرو: انتخاب بهترین متن میان مدل‌ها و اصلاح کلمه‌ای که تقریباً نام خودرو است
import test from 'node:test';
import assert from 'node:assert/strict';
import { carScore, fixCarWords } from '../src/vocab.js';

test('fixCarWords: نام خودروی نزدیک اصلاح می‌شود، بقیه دست نمی‌خورد', () => {
  assert.equal(fixCarWords('قیمت سرادو مدل ۹۸'), 'قیمت سراتو مدل ۹۸');
  assert.equal(fixCarWords('فیدلیته پرستیژ'), 'فیدلیتی پرستیژ');
  assert.equal(fixCarWords('اریزو شیش'), 'آریزو شیش');
  assert.equal(fixCarWords('کوئیک اتوماتیک'), 'کوئیک اتوماتیک', 'املای بانک اطلاعاتی؛ در تطبیق با «کوییک» یکی است');
  assert.equal(fixCarWords('سمندسورن'), 'سمندسورن', 'کلمهٔ ناشناخته بدون نام نزدیک');
  // کلمه‌های رایج و عددها و کلمه‌های کوتاه اصلاح نمی‌شوند
  for (const t of ['دیر شد', 'سمند سورن رنگ سفید کارکرد صد هزار', 'دنا پلاس تیپ دو', 'پژو دویست و شش', 'صندوق دار', 'جک اس پنج'])
    assert.equal(fixCarWords(t), t, t);
  // دو نام هم‌فاصله (هیوندای/هوندا): دست نمی‌خورد
  assert.equal(fixCarWords('هیوندا توسان'), 'هیوندا توسان');
});

test('carScore: پرسش خودرو بالاتر از کلمهٔ بی‌معنی', () => {
  assert.ok(carScore('پژو پارس') > carScore('بسیش'));
  assert.ok(carScore('قیمت کیا سراتو مدل ۹۸ چنده') > carScore('قیمت کیا سرا تو مدل'));
  assert.ok(carScore('جک اس پنج') > carScore('جک و جونور'));
  assert.equal(carScore(''), -1);
  assert.equal(carScore('بسیش'), 0);
});
