import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRelevant, pickBest, tokenSim } from '../src/match.js';
import { flattenVehicles, resolveVehicle } from '../src/sources/bama.js';

const vehicles = flattenVehicles(JSON.parse(readFileSync(new URL('./fixtures/bama-vehicles.json', import.meta.url))));

test('tokenSim: عدد دقیق، کلمه تقریبی', () => {
  assert.equal(tokenSim('206', '207'), 0);
  assert.equal(tokenSim('206', '206'), 1);
  assert.ok(tokenSim('هیوندا', 'هیوندای') >= 0.7);
});

test('pickBest: «کوئیک» و «کوییک» یکی هستند', () => {
  assert.equal(pickBest('کوئیک', [{ name: 'کوییک' }, { name: 'شاهین' }], (i) => i.name).item.name, 'کوییک');
});

test('resolveVehicle: تیپ گفته‌شده انتخاب می‌شود', () => {
  assert.equal(resolveVehicle(vehicles, 'پژو 206 تیپ 2').value, 'peugeot,206ir,type2');
});

test('resolveVehicle: بدون تیپ، مدل کلی (نه یک تیپ دلخواه)', () => {
  assert.equal(resolveVehicle(vehicles, 'پژو 206').value, 'peugeot,206ir');
  assert.equal(resolveVehicle(vehicles, 'پژو 206 صندوقدار').value, 'peugeot,206sd');
});

test('resolveVehicle: 2008 با 206 یا 207 اشتباه نمی‌شود', () => {
  assert.equal(resolveVehicle(vehicles, 'پژو 2008').value, 'peugeot,2008');
  assert.equal(resolveVehicle(vehicles, 'پژو 207').value, 'peugeot,207');
});

test('resolveVehicle: مترادف از keywords (پرشیا ← پژو پارس)', () => {
  assert.equal(resolveVehicle(vehicles, 'پرشیا').value, 'peugeot,pars');
});

test('resolveVehicle: خودروی ناشناخته', () => {
  assert.equal(resolveVehicle(vehicles, 'سلام خوبی'), null);
});

test('pickBest: املای متفاوت تشخیص گفتار', () => {
  const items = [{ name: 'تویوتا کمری' }, { name: 'تویوتا کرولا' }];
  assert.equal(pickBest('تیوتا کمری', items, (i) => i.name).item.name, 'تویوتا کمری');
});

test('isRelevant: عنوان آگهی دیوار', () => {
  assert.ok(isRelevant('پژو 206 تیپ 2', 'پژو ۲۰۶ تیپ ۲، مدل ۱۴۰۰'));
  assert.ok(!isRelevant('پژو 206 تیپ 2', 'پژو ۲۰۶ تیپ ۵، مدل ۱۴۰۰'));
  assert.ok(!isRelevant('پژو 206', 'پژو ۲۰۷ دنده‌ای، مدل ۱۴۰۲'));
});

test('حروف لاتین گفته‌شده: «جی ال ایکس» = GLX و «وی هشت» = V8', () => {
  const items = [{ name: 'پژو 405 GLI' }, { name: 'پژو 405 GLX بنزینی' }, { name: 'پژو 405 SLX موتور XU7' }];
  assert.equal(pickBest('پژو 405 جی ال ایکس', items, (i) => i.name).item.name, 'پژو 405 GLX بنزینی');
  assert.equal(pickBest('پژو 405 اس ال ایکس', items, (i) => i.name).item.name, 'پژو 405 SLX موتور XU7');
  assert.equal(resolveVehicle(vehicles, 'پژو 206 اس دی وی 8').value, 'peugeot,206sd,v8');
});
