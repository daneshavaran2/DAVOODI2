// تطبیق تقریبی نام خودرو (فارسی/انگلیسی) با فهرست مدل‌های هر سایت.
// تشخیص گفتار گاهی املای متفاوتی می‌دهد (هیوندا/هیوندای، کوئیک/کوییک)، پس تطبیق
// برای کلمه‌ها تقریبی است ولی برای عددها (206 در برابر 207) دقیق.

import { normalize } from './text.js';

// تشخیص گفتار، تیپ‌های لاتین را با حروف فارسی می‌نویسد («جی ال ایکس» به جای GLX).
// هر دو طرف (پرسش و نام سایت) به یک شکل لاتین برگردانده می‌شوند.
const SPOKEN_LATIN = [
  ['جی ال ایکس', 'glx'], ['جی ال ای', 'gli'], ['اس ال ایکس', 'slx'], ['ای ال ایکس', 'elx'], ['ال ایکس', 'lx'],
  ['اس دی', 'sd'], ['جی تی', 'gt'], ['اس ای', 'se'], ['سی وی تی', 'cvt'], ['ام وی ام', 'mvm'],
  ['ای اف (\\d+)', 'ef$2'], ['تی یو (\\d+)', 'tu$2'], ['ایکس یو (\\d+)', 'xu$2'], ['ال (\\d+)', 'l$2'],
  ['ایکس (\\d+)', 'x$2'], ['وی (\\d+)', 'v$2'], ['اچ (\\d+)', 'h$2'],
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

function levenshtein(a, b) {
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

/** شباهت دو کلمه بین ۰ و ۱. */
export function tokenSim(a, b) {
  if (a === b) return 1;
  if (isNum(a) || isNum(b)) return 0;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  if (Math.min(a.length, b.length) >= 4) {
    const r = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    if (r >= 0.75) return 0.7;
  }
  return 0;
}

const best = (t, pool) => pool.reduce((m, c) => Math.max(m, tokenSim(t, c)), 0);

/**
 * امتیاز یک نام نامزد برای کلمه‌های پرسش.
 * titleTok: کلمه‌های نام نامزد. extraTok: کلمه‌های کمکی (مترادف‌ها) که فقط برای پوشش پرسش حساب می‌شوند.
 */
export function scoreCandidate(qTok, titleTok, extraTok = []) {
  if (!qTok.length || !titleTok.length) return null;
  // عددی که در نام نامزد هست ولی در پرسش نیست، یعنی مدل دیگری است (207 به جای 206)
  if (titleTok.some((t) => isNum(t) && !qTok.includes(t))) return null;

  let mt = 0;
  for (const c of titleTok) mt += best(c, qTok);
  const pool = extraTok.length ? titleTok.concat(extraTok) : titleTok;
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
  if (precision < 0.5 && qm < 2) return null;
  return { score, precision, qm, mt };
}

/** بهترین مورد از items را برمی‌گرداند: { item, score, ... } یا null. */
export function pickBest(query, items, getTitle, getExtra = () => '') {
  const qTok = Array.isArray(query) ? query : tokens(query);
  let top = null;
  for (const item of items) {
    const s = scoreCandidate(qTok, tokens(getTitle(item)), tokens(getExtra(item) || ''));
    if (s && (!top || s.score > top.score)) top = { item, ...s };
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
