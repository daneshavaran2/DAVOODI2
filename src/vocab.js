// واژه‌های خودرو برای تشخیص گفتار:
//   ۱) carScore: از میان متن چند مدل تبدیل گفتار، کدام بیشتر شبیه «پرسش قیمت خودرو» است؟
//      («پژو پارس» بهتر از «بسیش»)
//   ۲) fixCarWords: کلمه‌ای که تقریباً نام خودرو است اصلاح شود («سرادو» ← «سراتو»، «فیدلیته» ← «فیدلیتی»).

import { isNum, levenshtein, phonetic } from './match.js';
import { isNumberWord, normalize, STOPWORDS } from './text.js';
import { CATALOG_SNAP_WORDS, CATALOG_WORDS, COLOR_PHRASES } from './catalog.js';
import { learnedWords, learningVersion } from './learning.js';

// نام سازنده‌ها، خودروها و تیپ‌های رایج بازار ایران (املای معمول)
const CAR_NAMES = `
پژو پارس پرشیا روآ آردی پراید تیبا ساینا کوییک شاهین سمند سورن دنا پلاس رانا تارا آریسان هایما پیکان سایپا
ایرانخودرو مدیران چری تیگو آریزو فونیکس فیدلیتی دیگنیتی جک لاماری بسترن دایون کارا نیسان زامیاد مکسیما
تویوتا کمری کرولا لندکروزر پرادو یاریس راوفور هایلوکس هیوندای سوناتا توسان النترا اکسنت سانتافه آزرا
جنسیس وراکروز کیا سراتو اسپورتیج سورنتو اپتیما ریو پیکانتو کادنزا مزدا رنو تندر ساندرو مگان کپچر کولیوس
داستر سیتروئن زانتیا بنز لکسوس پورشه فولکس شورولت ولوو جیلی امگرند هاوال جتور لیفان برلیانس آریو زوتی
بایک سوبارو میتسوبیشی پاجرو اوتلندر لندرور رنجرور سوزوکی ویتارا گرندویتارا هوندا آکورد سیویک آئودی
اینفینیتی کاپرا آریا اطلس کوییک پلاس اسپرت هاچبک صندوقدار اتوماتیک توربو کراس
`;

// کلمه‌های رایج پرسش (غیر از نام خودرو) که نباید «اصلاح» شوند
const QUERY_WORDS = `
تیپ مدل سال قیمت کارکرد کارکرده کیلومتر صفر دست دوم نو اتومات دنده دستی معمولی رنگ سفید مشکی نقره نقره‌ای
خاکستری آبی قرمز سبز بدون تصادف رنگ‌شدگی فول آپشن هزار میلیون میلیارد تومان تومن دار صندوق کابین دوگانه سوز
گازسوز شاسی بلند وانت تک دو بنزینی دیزلی هیبرید برقی ساخت تولید ورژن نسخه جدید قدیم قدیمی مدل‌های چه چی چطور
ایکس اس کیو زد ان دبلیو وان تری فور فایو سیکس سون ایت ناین سری کلاس پرو مکس کیلو وات
`;

// نام‌های کوتاه: فقط برای امتیاز (اصلاح کلمهٔ کوتاه خطرناک است: «دیر» ← «تارا»)
const SHORT_CAR_NAMES = 'جک کیا دنا بنز ریو ام وی کی سی بی جی ال اس تی';

const words = (s) => [...new Set(normalize(s).split(' ').filter((w) => w.length >= 3 && !/[a-z0-9]/.test(w)))];
// به‌اضافهٔ نام برندها و مدل‌های بانک اطلاعاتی (رسپکت، شوال، آزکارا، تانلند، کلوت، ونوسیا، …)
const BASE_CAR = [...new Set([...words(CAR_NAMES), ...CATALOG_SNAP_WORDS.map(normalize)])];
const BASE_SET = [...BASE_CAR, ...normalize(SHORT_CAR_NAMES).split(' '), ...CATALOG_WORDS.map(normalize)];
const QUERY = new Set([...normalize(QUERY_WORDS).split(' '), ...COLOR_PHRASES.flatMap((c) => normalize(c).split(' '))].filter(Boolean));

// واژه‌نامه = واژه‌های ثابت + واژه‌هایی که مدیر در پنل یاد داده (با هر تغییر آموزش دوباره ساخته می‌شود)
let CAR = BASE_CAR;
let CAR_SET = new Set(BASE_SET);
let KEY = new Map(CAR.map((w) => [w, phonetic(w)]));
let builtFor = -1;
function refresh() {
  if (builtFor === learningVersion()) return;
  builtFor = learningVersion();
  const extra = learnedWords().flatMap((w) => normalize(w).split(' ')).filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  CAR = [...new Set([...BASE_CAR, ...extra.filter((w) => w.length >= 4 && !/[a-z0-9]/.test(w))])];
  CAR_SET = new Set([...BASE_SET, ...extra]);
  KEY = new Map(CAR.map((w) => [w, phonetic(w)]));
}

// برای پرامپت مدل‌های ابری (بدون عدد؛ عدد در پرامپت باعث می‌شد مدل عددهای اشتباه بنویسد)
export const CLOUD_PROMPT =
  'قیمت خودرو: پژو پارس، پراید، سمند سورن، دنا پلاس، تیبا، ساینا، کوییک، شاهین، تارا، رانا، آریسان، ' +
  'هایما، چری تیگو، آریزو، فونیکس، فیدلیتی، دیگنیتی، جک، کیا سراتو، اسپورتیج، تویوتا کمری، هیوندای توسان، النترا، ' +
  'سوناتا، رنو تندر، مزدا، نیسان، زامیاد، بنز، لکسوس، بهمن رسپکت، فونیکس، کی ام سی، چانگان، هاوال، بی وای دی، ' +
  'ام وی ام، جیلی، لاماری، مکسوس، بی ام و، مدل، کارکرد.';

/** پرامپت مدل‌های تبدیل گفتار: نام‌های ثابت + واژه‌های یادگرفته در پنل (بدون عدد، حداکثر ۴۰) */
export function cloudPrompt() {
  const extra = learnedWords()
    .map((w) => w.replace(/[0-9۰-۹]+/g, '').replace(/\s+/g, ' ').trim())
    .filter((w) => w && !CLOUD_PROMPT.includes(w));
  return extra.length ? `${CLOUD_PROMPT.replace(/\.$/, '')}، ${[...new Set(extra)].slice(-40).join('، ')}.` : CLOUD_PROMPT;
}

const known = (t) => isNum(t) || /[a-z]/.test(t) || STOPWORDS.has(t) || QUERY.has(t) || isNumberWord(t) || t === 'و';

/** نزدیک‌ترین نام خودرو به یک کلمه، فقط اگر یکی و نزدیک باشد (وگرنه null) */
function nearestCar(t) {
  refresh();
  if (t.length < 4 || CAR_SET.has(t) || known(t)) return null;
  const k = phonetic(t);
  let best = null;
  let bestSim = 0;
  let tie = false;
  for (const c of CAR) {
    let sim = 0;
    if (c.length >= 4 && KEY.get(c) === k && k.length >= 2) sim = 0.9;
    else if (c.length >= 4) {
      const d = levenshtein(t, c);
      const n = Math.max(t.length, c.length);
      if (d <= (n >= 9 ? 2 : 1) && 1 - d / n >= 0.75) sim = 0.8;
    }
    if (sim > bestSim) [best, bestSim, tie] = [c, sim, false];
    else if (sim && sim === bestSim && c !== best) tie = true;
  }
  return best && !tie ? best : null;
}

/**
 * امتیاز «پرسش خودرو بودن» یک متن: سهم کلمه‌های شناخته‌شده (نام خودرو، عدد، تیپ، مدل، …)،
 * به‌اضافهٔ یک اگر دست‌کم یک نام خودرو دارد. متن خالی: ‎-1‎.
 */
export function carScore(text) {
  refresh();
  const tok = normalize(text).split(' ').filter(Boolean);
  if (!tok.length) return -1;
  let ok = 0;
  let car = false;
  for (const t of tok) {
    if (CAR_SET.has(t)) {
      ok += 1;
      car = true;
    } else if (known(t)) ok += 1;
    else if (nearestCar(t)) {
      ok += 0.6;
      car = true;
    }
  }
  return ok / tok.length + (car ? 1 : 0);
}

/** کلمه‌ای که تقریباً نام خودرو است با نام درست جایگزین می‌شود؛ بقیهٔ متن دست نمی‌خورد. */
export function fixCarWords(text) {
  return String(text || '')
    .split(' ')
    .map((w) => {
      const n = normalize(w);
      if (!n || n.includes(' ')) return w;
      return nearestCar(n) || w;
    })
    .join(' ');
}
