// فهرست برندها و مدل‌ها (از «بانک اطلاعاتی داوودی»، src/data/car-catalog.js) برای فهمیدن نام خودرو در گفتار:
//   - کد مدل‌هایی که با حروف گفته می‌شوند: «سی اس پنجاه و پنج» ← cs55، «جی اس» ← gs، «سیصد و بیست آی» ← 320i،
//     «اچ آر وی» ← hrv. فقط وقتی حروف یک کد واقعی از فهرست را می‌سازند تبدیل می‌شوند.
//   - برندهایی که خودشان حرف‌اند («ام جی»، «کی ام سی»، «بی وای دی»): یک نام می‌مانند تا حروفشان کد مدل حساب نشود.
//   - واژه‌های فارسی نام خودروها و رنگ‌ها.
// این ماژول به text.js وابسته نیست (text.js از آن استفاده می‌کند).

import { BRANDS, COLORS, MODELS } from './data/car-catalog.js';

const ZWNJ = '‌';
const norm = (s) =>
  String(s ?? '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// نام فارسی حروف لاتین، به ترتیب ترجیح («ای» بیشتر E است، «آ» و «اِی» A)
const LETTER_NAMES = {
  آ: ['a'], ای: ['e', 'a', 'i'], بی: ['b'], سی: ['c'], دی: ['d'], ئی: ['e'], اف: ['f'], جی: ['g', 'j'], اچ: ['h'],
  آی: ['i'], کی: ['k'], ال: ['l'], ام: ['m'], ان: ['n'], او: ['o'], پی: ['p'], کیو: ['q'], آر: ['r'], ار: ['r'],
  اس: ['s'], تی: ['t'], یو: ['u'], وی: ['v'], دبلیو: ['w'], دابلیو: ['w'], ایکس: ['x'], وای: ['y'], زد: ['z'], زی: ['z'],
};
/** گزینه‌های لاتین یک کلمه اگر نام حرف (یا خود یک حرف لاتین) است، وگرنه null */
export const letterOptions = (t) => LETTER_NAMES[t] || (/^[a-z]$/.test(t) ? [t] : null);

// ---------------------------------------------------------------- کد مدل‌ها

/** «CS 55 پلاس» ← ['cs55']، «NX 200t» ← ['nx200t', 'nx', '200t']، «HR-V» ← ['hrv'] */
function latinCodes(model) {
  const tok = norm(model)
    .split(' ')
    .map((t) => t.replace(/[-_.+]/g, ''))
    .filter((t) => /^[a-z0-9]+$/.test(t) && t);
  const codes = new Set();
  const isCode = (t) => /[a-z]/.test(t) && (/\d/.test(t) || t.length >= 2);
  for (let i = 0; i < tok.length; i++) {
    if (isCode(tok[i])) codes.add(tok[i]);
    // «CS 55»، «110 S»، «NX 200t»، «730 li»: حروف و عدد جدا نوشته شده
    if (i + 1 < tok.length && /[a-z]/.test(tok[i] + tok[i + 1]) && /\d/.test(tok[i] + tok[i + 1])) {
      const a = /^[a-z]+$/.test(tok[i]) || /^\d+$/.test(tok[i]);
      const b = /^[a-z]+\d*[a-z]*$/.test(tok[i + 1]) || /^\d+[a-z]*$/.test(tok[i + 1]);
      if (a && b) codes.add(tok[i] + tok[i + 1]);
    }
  }
  return [...codes];
}

/** کد ← برندهایی که مدلی با این کد دارند */
export const CODES = new Map();
const addCode = (c, brand) => {
  if (!CODES.has(c)) CODES.set(c, new Set());
  if (brand) CODES.get(c).add(brand);
};
for (const [brand, model] of MODELS) for (const c of latinCodes(model)) addCode(c, brand);
// تیپ‌ها و موتورهای رایج که در فهرست مدل‌ها نیستند ولی با حروف گفته می‌شوند («جی ال ایکس»، «تی یو فایو»)
for (const c of 'glx gli slx elx sd gt se cvt gl xli tu3 tu5 xu7 ef7 v8 l90'.split(' ')) addCode(c);

function* combos(letters) {
  if (!letters.length) {
    yield '';
    return;
  }
  for (const a of letterOptions(letters[0])) for (const rest of combos(letters.slice(1))) yield a + rest;
}

const isDigits = (t) => /^\d+$/.test(t ?? '');

function matchAt(tok, i, ok) {
  const run = (k, max) => {
    const r = [];
    while (r.length < max && k + r.length < tok.length && letterOptions(tok[k + r.length])) r.push(tok[k + r.length]);
    return r;
  };
  let best = null;
  const consider = (code, end) => {
    if (ok(code) && (!best || end > best.end)) best = { code, end };
  };
  const lead = run(i, 4);
  if (lead.length) {
    // حروف [+ عدد [+ حروف]]: بلندترین رشتهٔ حروف اول
    for (let n = lead.length; n >= 1 && !best; n--) {
      const k = i + n;
      for (const L of combos(lead.slice(0, n))) {
        if (isDigits(tok[k])) {
          const tail = run(k + 1, 2);
          for (let tn = tail.length; tn >= 0; tn--) for (const T of combos(tail.slice(0, tn))) consider(L + tok[k] + T, k + 1 + tn);
        }
        if (n >= 2) consider(L, k);
      }
    }
  } else if (isDigits(tok[i])) {
    // عدد + حروف: «۳۲۰ آی» ← 320i، «۱۱۰ اس» ← 110s
    const tail = run(i + 1, 2);
    for (let tn = tail.length; tn >= 1; tn--) for (const T of combos(tail.slice(0, tn))) consider(tok[i] + T, i + 1 + tn);
  }
  return best;
}

/**
 * حروف و عددهای گفته‌شده که با هم یک کد مدل از فهرست می‌سازند، به همان کد تبدیل می‌شوند.
 * tokens: کلمه‌های جمله (عددها با رقم). brands: برندهای گفته‌شده در جمله، برای انتخاب میان «ای»=E/A یا «جی»=G/J.
 */
export function joinSpokenCodes(tokens, brands = new Set()) {
  const withBrand = (c) => CODES.has(c) && [...CODES.get(c)].some((b) => brands.has(b));
  const any = (c) => CODES.has(c);
  const out = [];
  for (let i = 0; i < tokens.length; ) {
    const m = (brands.size && matchAt(tokens, i, withBrand)) || matchAt(tokens, i, any);
    // یک حرف تنها بدون عدد هیچ‌وقت کد حساب نمی‌شود (matchAt فقط دو حرف یا حرف+عدد را می‌پذیرد)
    if (m) {
      out.push(m.code);
      i = m.end;
    } else out.push(tokens[i++]);
  }
  return out;
}

// ---------------------------------------------------------------- برندها

const BRAND_NORM = BRANDS.map((b) => [b, norm(b)]);

/** برندهایی که فقط از نام حروف ساخته شده‌اند («ام جی»، «کی ام سی»، «بی وای دی»، …) */
export const LETTER_BRANDS = BRAND_NORM.filter(([, n]) => n.split(' ').length > 1 && n.split(' ').every((t) => LETTER_NAMES[t])).map(([, n]) => n);

/** برندهای گفته‌شده در جمله (متن normalize شده؛ نیم‌فاصله مثل فاصله) */
export function brandsIn(text) {
  const t = ` ${norm(text)} `;
  return new Set(BRAND_NORM.filter(([, n]) => t.includes(` ${n} `)).map(([b]) => b));
}

// نام‌های چندکلمه‌ای فهرست که کلمه‌ای شبیه عدد یا حرف دارند («سی لاین»، «سوپر بی»، «تی راک»): یک نام می‌مانند تا
// «سی» عدد ۳۰ یا «بی» حرف B حساب نشود
const NUMBERISH = new Set('یک دو سه چهار پنج شش هفت هشت نه ده سی صد'.split(' '));
const PROTECTED_NAMES = [
  ...new Set(
    MODELS.map(([, m]) => norm(m).replace(/[-_]/g, ' ').replace(/\s+/g, ' '))
      .filter((m) => {
        const t = m.split(' ');
        return t.length > 1 && t.every((w) => !/[a-z0-9+]/.test(w)) && t.some((w) => NUMBERISH.has(w) || LETTER_NAMES[w]);
      }),
  ),
];

/** برندهای حرفی و نام‌های عددمانند یک نام می‌شوند (با نیم‌فاصله) تا حروفشان کد مدل یا عدد حساب نشود */
export function protectLetterBrands(text) {
  let t = ` ${text} `;
  for (const b of [...LETTER_BRANDS, ...PROTECTED_NAMES]) t = t.split(` ${b} `).join(` ${b.split(' ').join(ZWNJ)} `);
  return t.trim();
}
export const _protectedNames = () => PROTECTED_NAMES;

// ---------------------------------------------------------------- واژه‌ها

/** واژه‌های فارسی نام برندها و مدل‌ها (برای امتیاز متن) */
export const CATALOG_WORDS = [
  ...new Set(
    [...BRANDS, ...MODELS.map(([, m]) => m)]
      .flatMap((s) => norm(s).split(' '))
      .filter((w) => w.length >= 2 && !/[a-z0-9+]/.test(w)),
  ),
];
// کلمه‌های عمومی که در نام‌ها هست ولی نباید کلمهٔ دیگری به آن‌ها «اصلاح» شود («ایرانی» ← «ایران» نه)
const GENERIC = new Set('ایران خودرو موتور پارس ماکس مدیران سوپر پرو نیو کراس پلاس توربو هیبرید هایبرید کلاسیک پریمیوم آفرود'.split(' '));
/** نام‌های متمایز (چهار حرف یا بیشتر) که کلمهٔ نزدیک به آن‌ها اصلاح می‌شود */
export const CATALOG_SNAP_WORDS = CATALOG_WORDS.filter((w) => w.length >= 4 && !GENERIC.has(w) && !LETTER_NAMES[w]);

/** نام کامل خودروها («بهمن رسپکت»، «چانگان CS55») برای دستور مدل‌های گفت‌وگوی صوتی */
export const CATALOG_NAMES = [...new Set(MODELS.map(([b, m]) => `${b} ${m}`))];

/** رنگ‌ها: عبارت‌ها (بلندترین اول) و کلمه‌های تکی */
export const COLOR_PHRASES = [...new Set(COLORS.map(norm))].sort((a, b) => b.length - a.length);
