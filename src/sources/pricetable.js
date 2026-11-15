// خواندن جدول قیمت خودرو از صفحهٔ HTML سایت‌هایی که «قیمت روز» منتشر می‌کنند
// (ایران‌جیب، car.ir، خودروبانک). بدون کتابخانهٔ بیرونی، و تا جای ممکن مستقل از شکل دقیق صفحه:
//   - جدول‌های <table>: ستون نام، «قیمت بازار» و «قیمت کارخانه/نمایندگی» از روی سرستون‌ها پیدا می‌شوند؛
//     سطرهای یک‌خانه‌ای (یا با کلاس catsection) نام خودروساز هستند.
//   - JSON داخل صفحه (__NEXT_DATA__ یا ld+json): هر شیئی که نام و قیمت دارد.
// واحد قیمت (تومان، ریال، هزار تومان، میلیون تومان) از سرستون و متن نزدیک جدول تشخیص داده می‌شود.

import { currentJalaliYear, normalize, toEnDigits } from '../text.js';
import { isNum, isRelevant, tokens, tokenSim } from '../match.js';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', zwnj: '‌', zwj: '', rlm: '', lrm: '' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export function stripTags(s) {
  return decodeEntities(
    String(s)
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[‎‏]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- واحد و مبلغ

/** واحد قیمت از روی متن سرستون یا عنوان: rial | toman | thousand | million | null */
export function unitHint(text) {
  const s = normalize(text || '');
  if (/ریال/.test(s)) return 'rial';
  if (/میلیون/.test(s)) return 'million';
  if (/هزار\s*تومان/.test(s)) return 'thousand';
  if (/تومان/.test(s)) return 'toman';
  return null;
}

const MIN_CAR = 50e6; // ۵۰ میلیون تومان
const MAX_CAR = 200e9; // ۲۰۰ میلیارد تومان

/**
 * «۱٬۲۵۰٬۰۰۰٬۰۰۰»، «1.250.000»، «۱ میلیارد و ۲۵۰ میلیون»، «۱,۲۵۰» (میلیون تومان) ← تومان، یا null.
 * hint: واحد ستون (اگر معلوم باشد). بدون آن، از بزرگی عدد حدس زده می‌شود.
 */
export function parseMoney(text, hint = null) {
  if (text === null || text === undefined) return null;
  let s = toEnDigits(String(text)).replace(/[‌‎‏]/g, '').trim();
  if (!/\d/.test(s)) return null;
  s = s.replace(/[٬،,']/g, ',').replace(/٫/g, '.');
  // خانه‌ای که جز واحد، حرف دارد (نام خودرو، «مدل ۱۴۰۴») مبلغ نیست
  if (/[a-zA-Z\u0600-\u06FF]/.test(s.replace(/میلیارد|میلیون|هزار|تومان|ریال|و|حدود|حدودا|حدوداً/g, ''))) return null;
  const words = /میلیارد|میلیون|هزار/.test(s);
  let v;
  if (words) {
    const num = (re) => {
      const m = s.replace(/,/g, '').match(re);
      return m ? parseFloat(m[1]) : 0;
    };
    v = num(/(\d+(?:\.\d+)?)\s*میلیارد/) * 1e9 + num(/(\d+(?:\.\d+)?)\s*میلیون/) * 1e6 + num(/(\d+(?:\.\d+)?)\s*هزار(?!\s*تومان)/) * 1e3;
    if (!v) return null;
    if (/ریال/.test(s) && !/تومان/.test(s)) v /= 10;
  } else {
    const m = s.match(/\d[\d,.\s]*/);
    if (!m) return null;
    let raw = m[0].replace(/\s+/g, '');
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, ''); // نقطه به‌جای جداکنندهٔ هزارگان
    const plain = !/[,.]/.test(raw);
    raw = raw.replace(/,/g, '');
    v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return null;
    const unit = hint || unitHint(s);
    // عدد چهاررقمی تنها و بدون واحد، احتمالاً سال است نه قیمت
    if (!unit && plain && ((v >= 1300 && v <= 1500) || (v >= 1950 && v <= 2050))) return null;
    if (unit === 'rial') v /= 10;
    else if (unit === 'million') v *= 1e6;
    else if (unit === 'thousand') v *= 1e3;
    else if (unit !== 'toman') {
      // بدون واحد: قیمت خودرو بین ۵۰ میلیون و ۲۰۰ میلیارد تومان است
      if (v < 1e5) v *= 1e6; // «۱٬۲۵۰» یعنی ۱٬۲۵۰ میلیون تومان
      else if (v < 1e7) v *= 1e3; // «۱٬۲۵۰٬۰۰۰» یعنی ۱٬۲۵۰٬۰۰۰ هزار تومان
      else if (v > MAX_CAR) v /= 10; // ریال
    }
  }
  v = Math.round(v);
  return v >= MIN_CAR && v <= MAX_CAR ? v : null;
}

/** سال ساخت در نام («... مدل ۱۴۰۴»، «... ۲۰۲۴») یا null */
export function yearIn(text) {
  const s = normalize(text || '');
  const m = s.match(/(?:^| )(1[34]\d\d|19[89]\d|20[0-4]\d)(?= |$)/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- جدول‌ها

function cellsOf(rowHtml) {
  return [...rowHtml.matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)(?=<\/t[hd]>|<t[hd]\b|$)/gi)].map((c) => ({
    head: c[1].toLowerCase() === 'th',
    attrs: c[2],
    text: stripTags(c[3]),
  }));
}

export function parseTables(html) {
  const tables = [];
  for (const tm of String(html).matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const rows = [...tm[2].matchAll(/<tr\b([^>]*)>([\s\S]*?)(?=<\/tr>|<tr\b|$)/gi)]
      .map((r) => ({ attrs: r[1], cells: cellsOf(r[2]) }))
      .filter((r) => r.cells.length);
    const before = stripTags(String(html).slice(Math.max(0, tm.index - 600), tm.index)).slice(-200);
    tables.push({ attrs: tm[1], rows, before });
  }
  return tables;
}

const MARKET_H = /بازار|آزاد|روز/;
const FACTORY_H = /کارخانه|نمایندگی|مصوب|شرکت|درب|کارخانجات/;
const NAME_H = /نام|خودرو|محصول|عنوان|مشخصات|تیپ/;
const YEAR_H = /^(سال|مدل|سال ساخت|سال تولید)$/;
const hasLetters = (t) => /[a-zA-Z؀-ۿ]{2}/.test(t.replace(/تومان|ریال|میلیون|میلیارد/g, ''));

function columnsFrom(header) {
  const cols = { name: -1, market: -1, factory: -1, year: -1, hints: {} };
  header.cells.forEach((c, i) => {
    const t = normalize(c.text);
    if (cols.factory < 0 && FACTORY_H.test(t)) cols.factory = i;
    else if (cols.market < 0 && MARKET_H.test(t)) cols.market = i;
    else if (cols.year < 0 && YEAR_H.test(t.replace(/[()]/g, '').trim())) cols.year = i;
    else if (cols.name < 0 && NAME_H.test(t) && !/قیمت/.test(t)) cols.name = i;
    cols.hints[i] = unitHint(t);
  });
  // تنها ستون «قیمت» (بدون «بازار») قیمت بازار است
  if (cols.market < 0) {
    const i = header.cells.findIndex((c, j) => j !== cols.factory && /قیمت/.test(c.text));
    if (i >= 0) cols.market = i;
  }
  if (cols.name < 0) cols.name = 0;
  return cols;
}

function isHeader(row) {
  const texts = row.cells.map((c) => normalize(c.text));
  const priceWords = texts.filter((t) => /قیمت|بازار|کارخانه|نمایندگی/.test(t)).length;
  const money = row.cells.filter((c) => parseMoney(c.text) !== null).length;
  return priceWords >= 1 && money === 0 && (row.cells.some((c) => c.head) || priceWords >= 2 || row.cells.length >= 2);
}

const isGroupRow = (row) =>
  /catsection|category|group|brand/i.test(row.attrs) ||
  (row.cells.length === 1 && hasLetters(row.cells[0].text) && parseMoney(row.cells[0].text) === null);

/** سطرهای قیمت همهٔ جدول‌های صفحه: { group, name, year, market, factory } */
export function rowsFromTables(html, pageHint = null) {
  const out = [];
  for (const t of parseTables(html)) {
    const tableHint = unitHint(t.before) || unitHint(t.attrs) || pageHint;
    let cols = null;
    let group = '';
    for (const row of t.rows) {
      if (isHeader(row)) {
        cols = columnsFrom(row);
        continue;
      }
      if (isGroupRow(row)) {
        group = row.cells[0].text;
        continue;
      }
      const cells = row.cells;
      if (cells.length < 2) continue;
      const hintAt = (i) => (cols?.hints[i] ?? null) || tableHint;
      let nameCell;
      let market = null;
      let factory = null;
      let year = null;
      if (cols && (cols.market >= 0 || cols.factory >= 0)) {
        nameCell = cells[cols.name] || cells.find((c) => hasLetters(c.text));
        if (cols.market >= 0 && cells[cols.market]) market = parseMoney(cells[cols.market].text, hintAt(cols.market));
        if (cols.factory >= 0 && cells[cols.factory]) factory = parseMoney(cells[cols.factory].text, hintAt(cols.factory));
        if (cols.year >= 0 && cells[cols.year]) year = yearIn(cells[cols.year].text);
      } else {
        // بدون سرستون: نام، سپس قیمت بازار و (اگر بود) قیمت کارخانه
        nameCell = cells.find((c) => hasLetters(c.text) && parseMoney(c.text) === null);
        const money = cells.filter((c) => c !== nameCell).map((c) => parseMoney(c.text, tableHint)).filter((v) => v !== null);
        [market = null, factory = null] = money;
      }
      if (!nameCell || !hasLetters(nameCell.text)) continue;
      if (market === null && factory === null) continue;
      const name = nameCell.text;
      out.push({ group, name, year: year || yearIn(name), market, factory });
    }
  }
  return out;
}

// ---------------------------------------------------------------- JSON داخل صفحه

const NAME_KEYS = ['name', 'title', 'carName', 'fullName', 'modelName', 'nickName', 'car_name', 'model_name', 'persianName', 'nameFa', 'title_fa'];
const MARKET_KEYS = /^(market_?price|bazaar_?price|bazar_?price|marketPrice|price_?market|free_?price|price|lowPrice)$/i;
const FACTORY_KEYS = /^(factory_?price|company_?price|agency_?price|dealer_?price|factoryPrice|price_?factory|approved_?price)$/i;

function jsonBlocks(html) {
  const blocks = [];
  for (const m of String(html).matchAll(/<script\b[^>]*(?:id="__NEXT_DATA__"|type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      /* JSON نامعتبر */
    }
  }
  return blocks;
}

/** هر شیء JSON که نام خودرو و قیمت دارد ← سطر قیمت */
export function rowsFromJson(html, pageHint = null) {
  const out = [];
  const seen = new Set();
  const walk = (node, group, depth) => {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, group, depth + 1);
      return;
    }
    const nameKey = NAME_KEYS.find((k) => typeof node[k] === 'string' && hasLetters(node[k]));
    let market = null;
    let factory = null;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      if (FACTORY_KEYS.test(k)) factory = factory ?? parseMoney(String(v), pageHint);
      else if (MARKET_KEYS.test(k)) market = market ?? parseMoney(String(v), pageHint);
    }
    if (node.offers && typeof node.offers === 'object' && !Array.isArray(node.offers)) {
      market = market ?? parseMoney(String(node.offers.price ?? node.offers.lowPrice ?? ''), node.offers.priceCurrency === 'IRR' ? 'rial' : pageHint);
    }
    if (nameKey && (market !== null || factory !== null)) {
      const name = node[nameKey].trim();
      const year = yearIn(String(node.year ?? node.modelYear ?? node.model_year ?? '')) || yearIn(name);
      const key = `${group}|${name}|${year}|${market}|${factory}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ group, name, year, market, factory });
      }
    }
    const nextGroup =
      typeof node.brandName === 'string' ? node.brandName : typeof node.brand === 'string' ? node.brand : node.brand?.name || node.brand?.title || group;
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, nextGroup, depth + 1);
  };
  for (const b of jsonBlocks(html)) walk(b, '', 0);
  return out;
}

/** همهٔ سطرهای قیمت یک صفحه (جدول‌ها و JSON) */
export function extractRows(html) {
  const title = stripTags((String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const pageHint = unitHint(title);
  const rows = [...rowsFromTables(html, pageHint), ...rowsFromJson(html, pageHint)];
  const seen = new Set();
  return rows.filter((r) => {
    const k = `${normalize(r.group)}|${normalize(r.name)}|${r.market}|${r.factory}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** پیوندهای صفحه که به «قیمت خودرو» می‌روند (برای پیدا کردن صفحهٔ قیمت از صفحهٔ اول سایت) */
export function priceLinks(html, base) {
  const out = [];
  const host = new URL(base).host.replace(/^www\./, '');
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = normalize(stripTags(m[2]));
    if (!/قیمت/.test(text) || !/خودرو|ماشین|روز|بازار/.test(text)) continue;
    let url;
    try {
      url = new URL(decodeEntities(m[1]), base);
    } catch {
      continue;
    }
    if (url.host.replace(/^www\./, '') !== host || !/^https?:$/.test(url.protocol)) continue;
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out;
}

// ---------------------------------------------------------------- تطبیق با خودروی پرسیده‌شده

/**
 * سطرهای مربوط به این خودرو. canon: نام کامل از باما (اگر هست)، وگرنه گفتهٔ کاربر.
 * همهٔ کلمه‌های نام (و عددها دقیقاً) باید در «خودروساز + نام» سطر باشند؛
 * اگر تیپ هم گفته شده، سطرهایی که کمترین کلمهٔ اضافه دارند انتخاب می‌شوند.
 */
export function matchRows(rows, { canon = null, carText = '' } = {}) {
  const name = canon ? canon.title : carText;
  const qTok = tokens(name);
  if (!qTok.length) return [];
  const moreSpecific = (canon?.moreSpecific || []).map(tokens);
  const scored = [];
  for (const r of rows) {
    const text = `${r.group} ${r.name}`;
    const rTok = tokens(text);
    if (!isRelevant(qTok, text, 1)) continue;
    if (!qTok.filter(isNum).every((n) => rTok.includes(n))) continue;
    // سطر مال مدل دقیق‌تری است (پژو ۲۰۶ SD برای پژو ۲۰۶)
    if (moreSpecific.some((ms) => ms.every((w) => rTok.some((t) => tokenSim(w, t) >= 0.85)))) continue;
    const nameTok = tokens(r.name);
    const extra = nameTok.filter((t) => !qTok.some((q) => tokenSim(q, t) >= 0.7)).length;
    scored.push({ r, extra });
  }
  if (!scored.length) return [];
  const specific = canon ? canon.level === 'trim' : false;
  if (!specific) return scored.map((s) => s.r);
  const min = Math.min(...scored.map((s) => s.extra));
  return scored.filter((s) => s.extra === min).map((s) => s.r);
}

/** سال سطر قیمت روز: بدون سال یعنی صفر کیلومتر امسال */
export function isCurrentYear(year, now = new Date()) {
  if (!year) return true;
  return year >= 1900 ? year >= now.getFullYear() - 1 : year >= currentJalaliYear(now) - 1;
}
