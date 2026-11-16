// پردازش متن فارسی: یکسان‌سازی حروف و ارقام، تبدیل عدد نوشتاری به رقم،
// و جدا کردن «نام خودرو»، «سال ساخت» و «صفر/کارکرده» از جملهٔ کاربر.

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toEnDigits(s) {
  return String(s ?? '')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export function toFaDigits(s) {
  return String(s ?? '').replace(/\d/g, (d) => FA_DIGITS[d]);
}

/** یکسان‌سازی برای پردازش: حروف عربی، ارقام، نیم‌فاصله، علائم و فاصلهٔ بین حرف و عدد. */
export function normalize(s) {
  return toEnDigits(s)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/[إأ]/g, 'ا')
    // حروف اردو/عربی که Whisper گاهی می‌نویسد: «شاہین» ← «شاهین»
    .replace(/[ہۂۃھۀ]/g, 'ه')
    .replace(/ڈ/g, 'د')
    .replace(/ڑ/g, 'ر')
    .replace(/ٹ/g, 'ت')
    .replace(/ں/g, 'ن')
    .replace(/ڪ/g, 'ک')
    .replace(/[ً-ٰٟـ]/g, '') // اعراب و کشیده
    .replace(/[‌‍‎‏ ]/g, ' ') // نیم‌فاصله و نویسه‌های جهت
    .replace(/(\d)[,٬،٬](?=\d{3}(\D|$))/g, '$1') // جداکنندهٔ هزارگان
    .replace(/[،,؛;:!?؟.()[\]{}"'«»/\\|_*+=~`<>-]+/g, ' ')
    // «پژو206» ← «پژو 206»؛ ولی کدهای لاتین مثل V8، TU5 و L90 یک کلمه می‌مانند
    .replace(/([؀-ۿ])(\d)/g, '$1 $2')
    .replace(/(\d)([؀-ۿ])/g, '$1 $2')
    .replace(/(\d{3,})([a-zA-Z])/g, '$1 $2') // «405GLX» ← «405 GLX»
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------- عدد نوشتاری

// شامل شکل‌های محاوره‌ای و آوایی که تشخیص گفتار می‌نویسد (چار، سد، نوود، هف، ...)
const UNITS = { یک: 1, دو: 2, سه: 3, چهار: 4, چار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هف: 7, هشت: 8, نه: 9 };
const TEENS = {
  ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, چارده: 14, پانزده: 15, پونزده: 15, پنزده: 15,
  شانزده: 16, شونزده: 16, هفده: 17, هیفده: 17, هجده: 18, هیجده: 18, نوزده: 19,
};
const TENS = { بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90, نوود: 90, نواد: 90 };
const HUNDREDS = {
  صد: 100, سد: 100, یکصد: 100, دویست: 200, دویس: 200, دیویست: 200, دیوست: 200, دیرست: 200, دیریست: 200, دریست: 200, سیصد: 300, سیسد: 300, چهارصد: 400, چارصد: 400,
  چارسد: 400, چهارسد: 400, پانصد: 500, پونصد: 500, پونسد: 500, ششصد: 600, شیشصد: 600, شیشسد: 600,
  هفتصد: 700, هفصد: 700, هشتصد: 800, هشصد: 800, نهصد: 900,
};
const THOUSAND = 'هزار';

/** کلمهٔ عدد نوشتاری («دویست»، «شیش»، «هزار»، …) */
export const isNumberWord = (w) => wordValue(w) !== null;

function wordValue(w) {
  if (w in UNITS) return { v: UNITS[w], rank: 1 };
  if (w in TEENS) return { v: TEENS[w], rank: 2 };
  if (w in TENS) return { v: TENS[w], rank: 3 };
  if (w in HUNDREDS) return { v: HUNDREDS[w], rank: 4 };
  if (w === THOUSAND) return { v: 1000, rank: 5 };
  return null;
}

/** «نوادو» ← «نواد و»، «نوادوشیش» ← «نواد و شیش»، «هزارو» ← «هزار و» (و چسبیده در گفتار). */
function splitAttachedVa(input) {
  // عدد دوتکه‌شده: «پانز ده» ← «پانزده»، «سی صد» ← «سیصد» (تشخیص گفتار یا نیم‌فاصله)
  const tok = [];
  for (let i = 0; i < input.length; i++) {
    if (i + 1 < input.length && wordValue(input[i] + input[i + 1])) {
      tok.push(input[i] + input[i + 1]);
      i++;
    } else tok.push(input[i]);
  }
  const out = [];
  for (const t of tok) {
    if (wordValue(t) || t.length < 3 || !t.includes('و')) {
      out.push(t);
      continue;
    }
    const parts = [];
    let rest = t;
    while (rest) {
      let found = false;
      for (let k = rest.length; k >= 1; k--) {
        const head = rest.slice(0, k);
        if (wordValue(head) && (rest.length === k || rest[k] === 'و')) {
          parts.push(head);
          if (rest.length > k) parts.push('و');
          rest = rest.slice(k + 1);
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (!rest && parts.length > 1) out.push(...parts);
    else out.push(t);
  }
  return out;
}

// پس از هر رتبه، کدام رتبه‌ها می‌توانند در همان عدد بیایند (دویست و شش، هزار و چهارصد، ...)
const NEXT = { 5: [4, 3, 2, 1], 4: [3, 2, 1], 3: [1], 2: [], 1: [] };

/** «پژو دویست و شش مدل نود و هشت» ← «پژو 206 مدل 98» (ورودی باید normalize شده باشد). */
export function wordsToDigits(text) {
  const tok = splitAttachedVa(text.split(' ').filter(Boolean));
  const out = [];
  let i = 0;
  while (i < tok.length) {
    const first = wordValue(tok[i]);
    if (!first) {
      out.push(tok[i]);
      i++;
      continue;
    }
    let total = 0;
    let cur = 0;
    let lastRank = 6;
    let lastUnit = null;
    let j = i;
    let end = i;
    while (j < tok.length) {
      let w = tok[j];
      let k = j;
      if (w === 'و' && j > i) {
        k = j + 1;
        w = tok[k];
      }
      // «یه» فقط بعد از «و» در میان عدد یعنی ۱ («سی و یه»)؛ در جای دیگر حرف تعریف است
      // «ست» فقط بلافاصله بعد از یکان یعنی «صد» («چار ست» = ۴۰۰؛ Whisper گاهی «صد» را «ست» می‌نویسد)
      const wv =
        w === undefined
          ? null
          : wordValue(w) ||
            (k > j && w === 'یه' ? { v: 1, rank: 1 } : null) ||
            (k === j && w === 'ست' && lastRank === 1 && lastUnit !== null ? { v: 100, rank: 4 } : null);
      if (!wv) break;
      if (wv.rank === 5) {
        // «هزار» ضرب‌کننده است: «هزار و چهارصد»، «دو هزار»
        if (lastRank === 5) break;
        cur = (cur || 1) * 1000;
        total += cur;
        cur = 0;
        lastRank = 5;
        lastUnit = null;
      } else if ((w === 'صد' || w === 'سد' || w === 'ست') && lastRank === 1 && lastUnit !== null) {
        // «چهار صد» جدا نوشته شده
        cur += lastUnit * 99;
        lastRank = 4;
        lastUnit = null;
      } else {
        const allowed = lastRank === 6 ? [4, 3, 2, 1] : NEXT[lastRank];
        if (!allowed.includes(wv.rank)) break;
        cur += wv.v;
        lastRank = wv.rank;
        lastUnit = wv.rank === 1 ? wv.v : null;
      }
      j = k + 1;
      end = j;
    }
    out.push(String(total + cur));
    i = end;
  }
  return out.join(' ');
}

// ---------------------------------------------------------------- سال ساخت

export function currentJalaliYear(now = new Date()) {
  const gy = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return m > 2 || (m === 2 && d >= 21) ? gy - 621 : gy - 622;
}

/** تبدیل عدد گفته‌شده به سال: 98←1398، 02←1402، 402←1402، 1399، 2018. */
export function toYear(numStr, now = new Date()) {
  const cj = currentJalaliYear(now);
  const cg = now.getFullYear();
  const n = parseInt(numStr, 10);
  if (!Number.isFinite(n)) return null;
  const len = numStr.length;
  if (len === 4) {
    if (n >= 1330 && n <= cj + 1) return { value: n, calendar: 'jalali' };
    if (n >= 1950 && n <= cg + 1) return { value: n, calendar: 'gregorian' };
    return null;
  }
  if (len === 3) {
    if (n >= 400 && n <= cj - 1000 + 1) return { value: 1000 + n, calendar: 'jalali' };
    return null;
  }
  // یک یا دو رقم
  if (n <= cj - 1400 + 1) return { value: 1400 + n, calendar: 'jalali' };
  if (n >= 50 && n <= 99) return { value: 1300 + n, calendar: 'jalali' };
  return null;
}

const YEAR_KEYWORD = /(^| )(مدل|سال|ساخت|تولید)( سال| ساخت)? (\d{1,4})(?= |$)/;

/**
 * سال را از متن (normalize شده) پیدا می‌کند.
 * خروجی: { year, rest } که rest همان متن بدون عبارت سال است.
 */
export function extractYear(text, now = new Date()) {
  let m = text.match(YEAR_KEYWORD);
  if (m) {
    const y = toYear(m[4], now);
    if (y) return { year: y, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim() };
  }
  const tok = text.split(' ');
  // عدد چهاررقمی شمسی در هر جای جمله
  for (let i = tok.length - 1; i >= 0; i--) {
    if (/^1[34]\d\d$/.test(tok[i])) {
      const y = toYear(tok[i], now);
      if (y) return { year: y, rest: [...tok.slice(0, i), ...tok.slice(i + 1)].join(' ') };
    }
  }
  // سال میلادی (برای خودروهای وارداتی) فقط در انتهای جمله و نه بعد از «پژو» (پژو 2008)
  const last = tok.length - 1;
  if (last > 0 && /^(19[5-9]\d|20[0-4]\d)$/.test(tok[last]) && !/^(پژو|peugeot)$/.test(tok[last - 1])) {
    const y = toYear(tok[last], now);
    if (y) return { year: y, rest: tok.slice(0, last).join(' ') };
  }
  // «پراید ۹۸»، «پارس دوگانه سوز ۹۶»: عدد دورقمی آخر جمله (۵۰ تا ۹۹ یا ۰۰ تا امسال) معمولاً سال است؛
  // ولی نه وقتی بخشی از نام مدل است («ال ۹۰»، «تیپ ۵»، «x 22»، «تیگو ۷»).
  if (
    last > 0 &&
    /^\d{2}$/.test(tok[last]) &&
    !/^(ال|l|x|ایکس|تیپ|وی|v|اس|s|اچ|h|کیو|q|ام|m|اف|f|تی|t|جی|g|تیگو|آریزو|اریزو|سی|c|ان|n|ای|e)$/i.test(tok[last - 1])
  ) {
    const y = toYear(tok[last], now);
    if (y && (Number(tok[last]) >= 50 || tok[last].startsWith('0'))) return { year: y, rest: tok.slice(0, last).join(' ') };
  }
  return { year: null, rest: text };
}

// ---------------------------------------------------------------- قیمت و کارکرد

function plainNumbers(text) {
  return toEnDigits(String(text ?? ''))
    .replace(/(\d)[,٬،٬](?=\d)/g, '$1')
    .replace(/(\d)[٫/](?=\d)/g, '$1.');
}

/** «۱,۸۰۰,۰۰۰,۰۰۰ تومان»، «۱ میلیارد و ۲۰۰ میلیون»، «توافقی» ← { price, note } به تومان. */
export function parseToman(text) {
  if (text === null || text === undefined || text === '') return { price: null, note: null };
  const s = plainNumbers(text);
  if (/توافق/.test(s)) return { price: null, note: 'توافقی' };
  if (/قسط|اقساط|پیش\s?‌?پرداخت|ماهانه/.test(s)) return { price: null, note: 'اقساطی' };
  if (/معاوضه|تهاتر/.test(s)) return { price: null, note: 'معاوضه' };
  if (/رایگان|مجانی/.test(s)) return { price: null, note: 'رایگان' };
  const bil = s.match(/(\d+(?:\.\d+)?)\s*میلیارد/);
  const mil = s.match(/(\d+(?:\.\d+)?)\s*میلیون/);
  let v;
  if (bil || mil) {
    v = (bil ? parseFloat(bil[1]) * 1e9 : 0) + (mil ? parseFloat(mil[1]) * 1e6 : 0);
  } else {
    const m = s.match(/\d+(?:\.\d+)?/);
    if (!m) return { price: null, note: null };
    v = parseFloat(m[0]);
  }
  if (/ریال/.test(s) && !/تومان/.test(s)) v /= 10;
  return { price: Math.round(v) || null, note: null };
}

/** «۱۴۰,۰۰۰ km»، «۵۰ هزار کیلومتر»، «کارکرد صفر» ← عدد کیلومتر یا null. */
export function parseKm(text) {
  if (!text) return null;
  const s = plainNumbers(text);
  if (/صفر/.test(s)) return 0;
  const k = s.match(/(\d+(?:\.\d+)?)\s*هزار/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// ---------------------------------------------------------------- جملهٔ کاربر

export const STOPWORDS = new Set([
  'قیمت', 'قیمتش', 'قیمتشو', 'قیمت‌', 'ماشین', 'ماشینم', 'خودرو', 'خودروی', 'اتومبیل', 'اتوموبیل',
  'چنده', 'چند', 'چقدر', 'چقد', 'چیه', 'است', 'هست', 'میشه', 'می', 'شه', 'رو', 'را', 'از', 'به', 'برای',
  'بگو', 'بگید', 'بده', 'بدید', 'میخوام', 'میخواستم', 'خوام', 'خواهم', 'خواستم', 'لطفا', 'لطفاً',
  'حدودی', 'حدود', 'تقریبی', 'تقریبا', 'امروز', 'روز', 'بازار', 'الان', 'الآن', 'فعلی', 'یه', 'سلام',
  'تومن', 'تومان', 'من', 'یک', 'دنبال', 'هستم', 'در', 'با', 'آیا', 'ایا', 'و', 'مدل', 'سال',
]);

// شکل‌های آوایی «مدل» و نام‌هایی که تشخیص گفتار گاهی به انگلیسی می‌نویسد
const ALIASES = {
  مودل: 'مدل', موديل: 'مدل', مودیل: 'مدل', موذل: 'مدل', model: 'مدل', year: 'سال', ایس: 'اس',
  peugeot: 'پژو', pejo: 'پژو', pride: 'پراید', samand: 'سمند', dena: 'دنا', tiba: 'تیبا', saina: 'ساینا',
  quick: 'کوییک', shahin: 'شاهین', tara: 'تارا', rana: 'رانا', runna: 'رانا', haima: 'هایما', chery: 'چری',
  tiggo: 'تیگو', toyota: 'تویوتا', camry: 'کمری', corolla: 'کرولا', kia: 'کیا', cerato: 'سراتو',
  sportage: 'اسپورتیج', hyundai: 'هیوندای', renault: 'رنو', nissan: 'نیسان', mazda: 'مزدا', jac: 'جک',
  plus: 'پلاس', pars: 'پارس', persia: 'پرشیا', soren: 'سورن', sarir: 'سریر',
};

const NEW_RE ='(^| )(کارکرد صفر|صفر کیلومتر|صفر|نو|آکبند|اکبند)(?= |$)';
const USED_RE = '(^| )(کارکرده|کار کرده|دست دوم|دسته دوم|دست 2)(?= |$)';
const NEW_WORDS = new RegExp(NEW_RE, 'g');
const USED_WORDS = new RegExp(USED_RE, 'g');
const IS_NEW = new RegExp(NEW_RE);
const IS_USED = new RegExp(USED_RE);

/**
 * «قیمت پژو دویست و شش تیپ دو مدل نود و هشت چنده؟»
 *   ← { carText: 'پژو 206 تیپ 2', year: {value:1398, calendar:'jalali'}, condition: null }
 */
export function parseQuery(raw, now = new Date()) {
  let text = normalize(raw);
  text = text
    .replace(/(^| )مو دل(?= |$)/g, '$1مدل')
    .split(' ')
    .map((t) => ALIASES[t] || t)
    .join(' ');
  // «یک» در «قیمت یک پژو» حرف تعریف است، نه عدد
  text = text.replace(/(^| )(قیمت|یه|برای|از) یک /g, '$1$2 ').replace(/^یک /, '');
  text = wordsToDigits(text);
  // «مدل صفر دو» یعنی ۱۴۰۲، نه «صفر کیلومتر»
  text = text.replace(/(^| )(مدل|سال|ساخت|تولید) (?:صفر|0) (\d)(?= |$)/g, '$1$2 0$3');

  let condition = null;
  if (IS_USED.test(text)) condition = 'used';
  else if (IS_NEW.test(text)) condition = 'new';
  text = text.replace(USED_WORDS, ' ').replace(NEW_WORDS, ' ').replace(/\s+/g, ' ').trim();

  const { year, rest } = extractYear(text, now);
  let carRest = rest;
  let yearUnclear = false;
  if (!year) {
    // «مدل» گفته شده ولی سال فهمیده نشد (مثلاً «مدل نواتونان» یا «مدل ۱۴۲۳»):
    // آن کلمه جزو نام خودرو نیست؛ خودرو پیدا می‌شود و به کاربر گفته می‌شود سال را نفهمیدیم
    const m = carRest.match(/(^| )(مدل|سال)( [^ ]+)?$/) || carRest.match(/(^| )(مدل|سال) (\d+)(?= )/);
    if (m) {
      carRest = (carRest.slice(0, m.index) + ' ' + carRest.slice(m.index + m[0].length)).trim();
      yearUnclear = Boolean(m[3]);
    }
  }
  const carText = carRest
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .join(' ');

  return { raw: String(raw ?? ''), normalized: text, carText, year, yearUnclear, condition };
}
