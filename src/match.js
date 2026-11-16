// تطبیق تقریبی نام خودرو (فارسی/انگلیسی) با فهرست مدل‌های هر سایت.
// تشخیص گفتار گاهی املای متفاوتی می‌دهد (هیوندا/هیوندای، کوئیک/کوییک)، پس تطبیق
// برای کلمه‌ها تقریبی است ولی برای عددها (206 در برابر 207) دقیق.

import { normalize } from './text.js';

// تشخیص گفتار، تیپ‌های لاتین را با حروف فارسی می‌نویسد («جی ال ایکس» به جای GLX).
// هر دو طرف (پرسش و نام سایت) به یک شکل لاتین برگردانده می‌شوند.
const SPOKEN_LATIN = [
  ['جی ال ایکس', 'glx'], ['جی الیکس', 'glx'], ['جیل ایکس', 'glx'], ['جی ال ای', 'gli'],
  ['اس ال ایکس', 'slx'], ['اس الیکس', 'slx'], ['ای ال ایکس', 'elx'], ['ای الیکس', 'elx'],
  ['ال ایکس', 'lx'], ['الیکس', 'lx'], ['صندوقدار', 'sd'], ['صندوق دار', 'sd'],
  ['اس دی', 'sd'], ['جی تی', 'gt'], ['اس ای', 'se'], ['سی وی تی', 'cvt'], ['ام وی ام', 'mvm'],
  ['بی ام و', 'bmw'], ['ب ام و', 'bmw'], ['بی ام دبلیو', 'bmw'],
  ['ای اف (\\d+)', 'ef$2'], ['تی یو (\\d+)', 'tu$2'], ['ایکس یو (\\d+)', 'xu$2'], ['ال (\\d+)', 'l$2'],
  ['ایکس (\\d+)', 'x$2'], ['وی (\\d+)', 'v$2'], ['اچ (\\d+)', 'h$2'], ['اس (\\d+)', 's$2'], ['کیو (\\d+)', 'q$2'],
  ['سی (\\d+)', 'c$2'],
].map(([fa, en]) => [new RegExp(`(^| )${fa}(?= |$)`, 'g'), `$1${en}`]);

export function fold(s) {
  let t = normalize(s).replace(/آ/g, 'ا').replace(/ئ/g, 'ی').replace(/ء/g, '');
  for (const [re, en] of SPOKEN_LATIN) t = t.replace(re, en);
  return t;
}

export function tokens(s) {
  return fold(s).split(' ').filter(Boolean);
}

export const isNum = (t) => /^\d+$/.test(t);

export function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// کلید آوایی: حروف هم‌صدا یکی می‌شوند (س/ص/ث، ز/ذ/ض/ظ، ت/ط/د، ...)، حروف صدادار میانی حذف می‌شوند.
// تشخیص گفتار اغلب کلمه را همان‌طور که شنیده می‌نویسد: «پجو» یا «پیجو» به جای «پژو»، «تیب» به جای «تیپ».
const PHON = { ث: 'س', ص: 'س', ذ: 'ز', ض: 'ز', ظ: 'ز', ط: 'ت', د: 'ت', ح: 'ه', غ: 'ق', ژ: 'ج', پ: 'ب', ع: 'ا' };

export function phonetic(w) {
  if (/[a-z0-9]/.test(w)) return w;
  const s = [...w].map((c) => PHON[c] || c).join('');
  return (s[0] + s.slice(1).replace(/[اوی]/g, '')).replace(/ه$/, '').replace(/(.)\1+/g, '$1');
}

/** شباهت دو کلمه بین ۰ و ۱. */
export function tokenSim(a, b) {
  if (a === b) return 1;
  if (isNum(a) || isNum(b)) return 0;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  if (Math.min(a.length, b.length) >= 4) {
    const r = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    if (r >= 0.75) return 0.7;
  }
  if (Math.min(a.length, b.length) >= 3) {
    const pa = phonetic(a);
    const pb = phonetic(b);
    if (pa.length >= 2 && pa === pb) return 0.75;
  }
  return 0;
}

const best = (t, pool) => pool.reduce((m, c) => Math.max(m, tokenSim(t, c)), 0);

/**
 * امتیاز یک نام نامزد برای کلمه‌های پرسش.
 * titleTok: کلمه‌های نام نامزد. extraTok: کلمه‌های کمکی (مترادف‌ها) که فقط برای پوشش پرسش حساب می‌شوند.
 */
// مشخصه‌های فنی و وضعیت: در امتیاز حساب می‌شوند (تیپ «۸ سیلندر» را بهتر کنند) ولی به‌تنهایی خودرویی را انتخاب نمی‌کنند.
// «لند کروز ۸ سیلندر» نباید «کیا موهاوی ۸ سیلندر» شود فقط چون «۸ سیلندر» در نامش هست.
const SPEC_WORDS = new Set([
  'سیلندر', 'دنده', 'توربو', 'اتوماتیک', 'اتومات', 'دستی', 'هیبرید', 'هایبرید', 'برقی', 'دوگانه', 'سوز', 'گازسوز',
  'بنزینی', 'دیزلی', 'اسپرت', 'فول', 'لیتر', 'لیتری', 'cc', 'اسب', 'بخار', 'دیفرانسیل', '4x4',
]);
/** کدام کلمه‌های پرسش مشخصهٔ فنی‌اند (عددِ پیش از مشخصه هم: «8 سیلندر»، «6 دنده») */
function specMask(qTok) {
  return qTok.map((t, i) => SPEC_WORDS.has(t) || (isNum(t) && SPEC_WORDS.has(qTok[i + 1] || '')));
}

export function scoreCandidate(qTok, titleTok, extraTok = []) {
  if (!qTok.length || !titleTok.length) return null;
  // عددی که در نام نامزد هست ولی در پرسش نیست، یعنی مدل دیگری است (207 به جای 206)
  if (titleTok.some((t) => isNum(t) && !qTok.includes(t))) return null;

  let mt = 0;
  for (const c of titleTok) mt += best(c, qTok);
  const pool = extraTok.length ? titleTok.concat(extraTok) : titleTok;
  const spec = specMask(qTok);
  const core = qTok.filter((_, i) => !spec[i]);
  // پرسش فقط مشخصهٔ فنی است («۸ سیلندر اتوماتیک»): خودرویی انتخاب نمی‌شود
  if (!core.length) return null;
  // نامزد باید در «نام» با پرسش شریک باشد، نه فقط در مشخصهٔ فنی:
  //   یک کلمهٔ نام (نزدیک)، یا عدد مدل (۲۰۶، ۱۳۱؛ نه ۸ در «۸ سیلندر»)، یا کلمه‌ای یک‌حرف‌متفاوت («پاس»/«پارس») به‌همراه مشخصه
  const names = core.filter((t) => !isNum(t));
  if (names.length && !names.some((q) => best(q, pool) >= 0.7)) {
    const numHit = core.some((q) => isNum(q) && titleTok.includes(q));
    const weak = names.some((q) => q.length >= 3 && pool.some((t) => !isNum(t) && t.length >= 3 && levenshtein(q, t) === 1));
    const specHit = qTok.some((q, i) => spec[i] && !isNum(q) && best(q, pool) >= 0.7);
    if (!numHit && !(weak && specHit)) return null;
  }
  let qm = 0;
  for (const q of qTok) qm += best(q, pool);
  if (qm === 0) return null;
  if (mt === 0) {
    // فقط از راه مترادف‌ها (مثلاً «پرشیا» برای «پژو پارس»): همهٔ پرسش باید پوشش داده شود
    if (qm < qTok.length - 0.2) return null;
    return { score: qm * 2 - 0.5, precision: 0, qm, mt };
  }

  const precision = mt / titleTok.length;
  let score = qm * 2 + precision * 3 + mt * 0.5;
  const qNums = qTok.filter(isNum);
  if (qNums.length && !titleTok.some(isNum) && !extraTok.some((t) => qNums.includes(t))) score -= 3;
  // همهٔ کلمه‌های گفته‌شده (جز مشخصه‌های فنی) در نام هست («سورن» برای «سمند سورن») یا نام بیشترش در پرسش آمده
  const must = core.length ? core : qTok;
  const coversQuery = must.every((q) => best(q, pool) >= 0.7);
  const qmCore = must.reduce((sum, q) => sum + best(q, pool), 0);
  if (precision < 0.5 && qmCore < 2 && !coversQuery) return null;
  return { score, precision, qm, mt };
}

/**
 * شکل‌های دیگر پرسش با چسباندن دو کلمهٔ کنار هم؛ تشخیص گفتار گاهی یک کلمه را دو تکه می‌نویسد
 * («سرا تو» به جای «سراتو»).
 */
export function joinVariants(qTok) {
  const out = [qTok];
  for (let i = 0; i + 1 < qTok.length; i++) {
    const a = qTok[i];
    const b = qTok[i + 1];
    if (isNum(a) || isNum(b) || a.length + b.length < 4 || SPEC_WORDS.has(a) || SPEC_WORDS.has(b)) continue;
    out.push([...qTok.slice(0, i), a + b, ...qTok.slice(i + 2)]);
  }
  return out;
}

/** بهترین مورد از items را برمی‌گرداند: { item, score, ... } یا null. */
export function pickBest(query, items, getTitle, getExtra = () => '') {
  const qTok = Array.isArray(query) ? query : tokens(query);
  let top = null;
  for (const variant of joinVariants(qTok)) {
    for (const item of items) {
      const s = scoreCandidate(variant, tokens(getTitle(item)), tokens(getExtra(item) || ''));
      if (s && (!top || s.score > top.score)) top = { item, ...s, query: variant };
    }
  }
  return top;
}

/** کلمه‌هایی از پرسش که در نام انتخاب‌شده نیامده‌اند (مثلاً «تیپ 2» یا «اتوماتیک»). */
export function leftoverTokens(query, title) {
  const qTok = Array.isArray(query) ? query : tokens(query);
  const tTok = tokens(title);
  return qTok.filter((q) => best(q, tTok) < 0.7);
}

/** آیا متنی (مثلاً عنوان آگهی) به پرسش مربوط است؟ همهٔ عددها باید باشند و بیشتر کلمه‌ها. */
export function isRelevant(query, text, minRatio = 0.6) {
  const qTok = Array.isArray(query) ? query : tokens(query);
  if (!qTok.length) return false;
  const tTok = tokens(text);
  if (!qTok.filter(isNum).every((n) => tTok.includes(n))) return false;
  const hit = qTok.filter((q) => best(q, tTok) >= 0.7).length;
  return hit / qTok.length >= minRatio;
}
