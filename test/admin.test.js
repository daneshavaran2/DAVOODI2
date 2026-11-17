// پنل مدیریت: گزارش جستجوها، آموزش (قاعده و واژه)، ورود با رمز و امنیت API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'admin-test-'));
process.env.DATA_DIR = dir;
process.env.DEMO = '1';
delete process.env.ADMIN_PASSWORD;

const learning = await import('../src/learning.js');
const { createSearchLog } = await import('../src/searchlog.js');
const { carScore, cloudPrompt } = await import('../src/vocab.js');

test('قاعده‌ها: عبارت بلندتر اول، فقط کلمهٔ کامل، دوباره اعمال نمی‌شود، خاموش اثری ندارد، ذخیره و بازخوانی', async () => {
  learning._resetLearning();
  await learning.initLearning(dir);
  const a = learning.addRule('لند کروز', 'تویوتا لندکروزر');
  learning.addRule('کروز', 'شورلت کروز');
  learning.addRule('پارس', 'پژو پارس');
  assert.deepEqual(learning.applyRules('قیمت لند کروز ۲۰۰۶').text, 'قیمت تویوتا لندکروزر ۲۰۰۶');
  assert.equal(learning.applyRules('کروز ۲۰۱۵').text, 'شورلت کروز ۲۰۱۵');
  assert.equal(learning.applyRules('لندکروزر').applied.length, 0, 'وسط کلمه نه');
  assert.equal(learning.applyRules('پژو پارس ۹۸').applied.length, 0, '«پارس» ← «پژو پارس» روی «پژو پارس» دوباره نه');
  assert.equal(learning.applyRules('پارس ۹۸').text, 'پژو پارس ۹۸');
  assert.equal(learning.applyRules('سمند سورن').text, 'سمند سورن', 'بی قاعده: همان متن');
  learning.updateRule(a.id, { enabled: false });
  assert.ok(!learning.applyRules('لند کروز').applied.some((x) => x.id === a.id), 'قاعدهٔ خاموش اعمال نمی‌شود');
  assert.throws(() => learning.addRule('', 'x'), /خالی/);
  assert.throws(() => learning.addRule('سمند', 'سمند'), /یکی‌اند/);
  // همان عبارت دوباره: به‌روز می‌شود، تکراری نه
  learning.addRule('لند کروز', 'تویوتا لند کروزر');
  assert.equal(learning.listLearning().rules.filter((r) => r.from === 'لند کروز').length, 1);
  learning.addWord('جتور دشینگ');
  learning.addWord('جتور  دشینگ');
  assert.equal(learning.listLearning().words.length, 1);
  await learning._flushLearning();
  const saved = JSON.parse(await readFile(join(dir, 'learning.json'), 'utf8'));
  assert.equal(saved.rules.length, 3);
  learning._resetLearning();
  assert.equal(learning.listLearning().rules.length, 0);
  await learning.initLearning(dir);
  assert.equal(learning.listLearning().rules.length, 3, 'پس از راه‌اندازی دوباره');
});

test('واژه‌های یادگرفته به پرامپت مدل‌های گفتار و امتیاز متن می‌رسند', async () => {
  learning._resetLearning();
  await learning.initLearning(await mkdtemp(join(tmpdir(), 'words-')));
  assert.doesNotMatch(cloudPrompt(), /دشینگ/);
  const before = carScore('دشینگ');
  learning.addWord('جتور دشینگ ۲۰۲۴');
  assert.match(cloudPrompt(), /جتور دشینگ/);
  assert.doesNotMatch(cloudPrompt(), /۲۰۲۴/, 'بدون عدد');
  assert.ok(carScore('دشینگ') > before, 'واژهٔ تازه نام خودرو حساب می‌شود');
});

test('گزارش جستجوها: صافی‌ها، آمار، CSV، نگه‌داری روی دیسک و حذف قدیمی‌ها', async () => {
  const d = await mkdtemp(join(tmpdir(), 'log-'));
  const old = { id: 'old', at: new Date(Date.now() - 400 * 86_400_000).toISOString(), day: '2025-01-01', q: 'قدیمی', found: true };
  await writeFile(join(d, 'searches.jsonl'), `${JSON.stringify(old)}\n{خط خراب\n`);
  const log = createSearchLog({ dir: d, retentionDays: 180 });
  const st = await log.init();
  assert.equal(st.persistent, true);
  assert.equal(st.count, 0, 'قدیمی‌تر از ۱۸۰ روز و خط خراب حذف شد');
  const u = log.userKey('1.2.3.4');
  assert.equal(u, log.userKey('1.2.3.4'));
  assert.ok(!u.includes('1.2.3.4'));
  log.add({ kind: 'voice', q: 'پژو ۲۰۶ تیپ ۲', heard: 'پژو ۲۰۶ تیپ ۲', car: 'پژو 206 تیپ 2', found: true, price: 1.5e9, year: 1398, stt: { model: 'google/chirp-3', ms: 1200 }, user: u });
  log.add({ kind: 'text', q: 'سراتو ۲۰۱۵', car: 'کیا سراتو', found: true, price: 4e9, year: 2015, user: log.userKey('5.6.7.8') });
  log.add({ kind: 'voice', q: 'بسیش', heard: 'بسیش', found: false, error: 'نام خودرو تشخیص داده نشد.', stt: { model: 'google/chirp-3', ms: 900 }, user: u });
  log.add({ kind: 'text', q: 'تویوتا لندکروزر', car: 'تویوتا لندکروزر', found: true, price: 9e9, rules: [{ from: 'لند کروز', to: 'تویوتا لندکروزر' }] });
  log.add({ kind: 'voice', q: 'پژو ۲۰۶ تیپ ۲', car: 'پژو 206 تیپ 2', found: true, price: 1.6e9, year: 1398 });

  assert.equal(log.list().total, 5);
  assert.equal(log.list().items[0].q, 'پژو ۲۰۶ تیپ ۲', 'تازه‌ترین اول');
  assert.equal(log.list({ filter: 'missed' }).total, 1);
  assert.equal(log.list({ filter: 'voice' }).total, 3);
  assert.equal(log.list({ filter: 'learned' }).total, 1);
  assert.equal(log.list({ text: 'سراتو' }).total, 1);
  assert.equal(log.list({ limit: 2, offset: 4 }).items.length, 1);

  const s = log.summary({ days: 7 });
  assert.equal(s.totals.today, 5);
  assert.equal(s.totals.range, 5);
  assert.equal(s.users, 2);
  assert.equal(s.foundRate, 0.8);
  assert.equal(s.voiceShare, 0.6);
  assert.equal(s.avgSttMs, 1050);
  assert.equal(s.learned, 1);
  assert.deepEqual(s.topCars[0], { ...s.topCars[0], car: 'پژو 206 تیپ 2', count: 2, lastPrice: 1.6e9 });
  assert.equal(s.topBrands.find((b) => b.brand === 'پژو').count, 2);
  assert.equal(s.missed[0].q, 'بسیش');
  assert.equal(s.perDay.length, 7);
  assert.equal(s.perDay.at(-1).total, 5);
  assert.equal(s.hours.reduce((a, b) => a + b, 0), 5);
  assert.deepEqual(s.sttModels, [{ model: 'google/chirp-3', count: 2 }]);

  const csv = log.csv({ days: 7 });
  assert.ok(csv.startsWith('﻿'), 'BOM برای Excel');
  assert.equal(csv.trim().split('\r\n').length, 6);
  assert.match(csv, /لند کروز ← تویوتا لندکروزر/);

  await log.flush();
  const again = createSearchLog({ dir: d });
  assert.equal((await again.init()).count, 5, 'پس از راه‌اندازی دوباره');
});

test('پنل مدیریت: بی رمز خاموش؛ ورود؛ امنیت؛ آمار؛ آموزش روی جستجو اثر دارد', async () => {
  learning._resetLearning();
  await learning.initLearning(dir);
  const { server, searchLog } = await import('../server.js');
  const { _resetFails } = await import('../src/admin.js');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(`${base}/admin/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    // بی ADMIN_PASSWORD
    assert.deepEqual(await (await fetch(`${base}/admin/api/me`)).json(), { enabled: false, loggedIn: false });
    assert.equal((await post('login', { password: '' })).status, 503);
    const page = await fetch(`${base}/admin`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex');
    assert.match(await page.text(), /admin\.js\?v=/);

    process.env.ADMIN_PASSWORD = 'رمز-آزمون-۱۲۳';
    assert.equal((await fetch(`${base}/admin/api/summary`)).status, 401);
    assert.equal((await post('login', { password: 'غلط' })).status, 401);
    const ok = await post('login', { password: 'رمز-آزمون-۱۲۳' });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\/admin/);
    const cookie = setCookie.split(';')[0];
    const auth = { cookie };
    assert.deepEqual(await (await fetch(`${base}/admin/api/me`, { headers: auth })).json(), { enabled: true, loggedIn: true });
    // کوکی دست‌کاری‌شده
    assert.equal((await fetch(`${base}/admin/api/summary`, { headers: { cookie: cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) } })).status, 401);

    // جستجوها ثبت می‌شوند (صوتی با تشخیص گفتار مرورگر و تایپی)
    await fetch(`${base}/api/price?${new URLSearchParams({ q: 'پژو دویست و شش تیپ دو مدل نود و هشت', voice: 'browser' })}`);
    await fetch(`${base}/api/price?${new URLSearchParams({ q: '2026' })}`);
    const list = await (await fetch(`${base}/admin/api/searches?filter=all`, { headers: auth })).json();
    assert.equal(list.total, 2);
    assert.equal(list.items[1].kind, 'voice');
    assert.equal(list.items[1].car, 'پژو 206 تیپ 2');
    assert.equal(list.items[1].found, true);
    assert.equal(list.items[0].found, false);
    assert.match(list.items[0].error, /را شنیدم، ولی نام خودرو را نه/);
    assert.ok(!JSON.stringify(list).includes('127.0.0.1'), 'IP ذخیره نمی‌شود');
    const sum = await (await fetch(`${base}/admin/api/summary?days=7`, { headers: auth })).json();
    assert.equal(sum.totals.today, 2);
    assert.equal(sum.missed[0].q, '2026');

    // تغییر بی سرآیند X-Admin رد می‌شود (فرم سایت دیگر)
    assert.equal((await post('rules', { from: 'لند کروز', to: 'تویوتا لندکروزر' }, auth)).status, 403);
    const admin = { ...auth, 'x-admin': '1' };
    const r = await (await post('rules', { from: 'بسیش', to: 'پژو پارس' }, admin)).json();
    assert.equal(r.rule.to, 'پژو پارس');
    assert.equal((await post('rules', { from: '', to: 'x' }, admin)).status, 400);
    // آزمون جمله و اثر روی جستجوی واقعی
    const t = await (await post('test', { q: 'بسیش مدل ۹۸' }, admin)).json();
    assert.equal(t.text, 'پژو پارس مدل ۹۸');
    assert.equal(t.year, 1398);
    await fetch(`${base}/api/price?${new URLSearchParams({ q: 'بسیش مدل ۹۸' })}`);
    const last = (await (await fetch(`${base}/admin/api/searches?filter=learned`, { headers: auth })).json()).items[0];
    assert.equal(last.q, 'بسیش مدل ۹۸');
    assert.deepEqual(last.rules.map((x) => x.to), ['پژو پارس']);
    assert.equal((await (await fetch(`${base}/admin/api/learning`, { headers: auth })).json()).rules[0].hits, 1);
    // خاموش و حذف
    assert.equal((await post(`rules/${r.rule.id}`, { enabled: false }, admin)).status, 200);
    assert.equal((await fetch(`${base}/admin/api/rules/${r.rule.id}`, { method: 'DELETE', headers: admin })).status, 200);
    assert.equal((await fetch(`${base}/admin/api/rules/${r.rule.id}`, { method: 'DELETE', headers: admin })).status, 404);
    // واژه
    assert.equal((await post('words', { word: 'جتور دشینگ' }, admin)).status, 200);
    assert.equal((await fetch(`${base}/admin/api/words?word=${encodeURIComponent('جتور دشینگ')}`, { method: 'DELETE', headers: admin })).status, 200);
    // خروجی Excel
    const csv = await fetch(`${base}/admin/api/export.csv?days=7`, { headers: auth });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.headers.get('content-disposition'), /attachment/);
    assert.deepEqual([...new Uint8Array(await csv.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM برای Excel');

    // تلاش زیاد با رمز غلط: قفل ۱۵ دقیقه‌ای (برای همان IP)
    _resetFails();
    for (let i = 0; i < 8; i++) assert.equal((await post('login', { password: `غلط${i}` })).status, 401);
    assert.equal((await post('login', { password: 'رمز-آزمون-۱۲۳' })).status, 429);
    _resetFails();

    // خروج: کوکی پاک می‌شود؛ تغییر رمز همهٔ نشست‌ها را باطل می‌کند
    assert.match((await post('logout', {}, auth)).headers.get('set-cookie'), /Max-Age=0/);
    process.env.ADMIN_PASSWORD = 'رمز-تازه';
    assert.equal((await fetch(`${base}/admin/api/summary`, { headers: auth })).status, 401);
    assert.ok(searchLog.status().persistent === false, 'در آزمون، گزارش فقط در حافظه (init نشده)');
  } finally {
    delete process.env.ADMIN_PASSWORD;
    await new Promise((r) => server.close(r));
  }
});
