// baravard.com: برآورد قیمت خودروی کارکرده برای هر تیپ و سال ساخت.
// به خواست صاحب برنامه، در صفحه و پاسخ API با نام عمومی «منبع دیگر» و بدون پیوند نشان داده می‌شود.
//
// صفحه‌ها: هر تیپ صفحهٔ /pricing/{شناسه}/{نام}?model={سال} دارد. فهرست تیپ‌ها از پیوندهای همین الگو در
// صفحه‌های اول و «pricing» سایت ساخته می‌شود (هر ۶ ساعت)، سپس صفحهٔ تیپِ پیدا‌شده با سال خواسته‌شده خوانده می‌شود.

import { HOUR, request, SourceError } from '../http.js';
import { normalize } from '../text.js';
import { decodeEntities, matchRows, parseMoney, stripTags } from './pricetable.js';

export const SITE = 'https://baravard.com';
export const info = { id: 'other', name: 'منبع دیگر' };

const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.5',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'upgrade-insecure-requests': '1',
};

const TRIM_LINK = /href="((?:https?:\/\/(?:www\.)?baravard\.com)?\/pricing\/(\d+)\/([^"?#\s]+))[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

const page = (url, ttl = HOUR) => request(url, { as: 'text', headers: PAGE_HEADERS, ttl, timeout: 20000 });

function slugName(slug) {
  let s = slug;
  try {
    s = decodeURIComponent(slug);
  } catch {
    /* بدون کدگذاری */
  }
  return s.replace(/[-_]+/g, ' ').trim();
}

/** پیوندهای تیپ‌ها در یک صفحه ← [{ id, slug, name }] */
export function catalogFromHtml(html) {
  const out = new Map();
  for (const m of String(html).matchAll(TRIM_LINK)) {
    const id = m[2];
    const slug = decodeEntities(m[3]).replace(/\/+$/, '');
    const text = stripTags(m[4]);
    const name = /[؀-ۿa-zA-Z]{2}/.test(text) && text.length <= 80 ? text : slugName(slug);
    if (!out.has(id)) out.set(id, { id, slug, name });
  }
  return [...out.values()];
}

/** پیوندهای «فهرستی» هم‌سایت (برند، دسته) که ممکن است پیوند تیپ‌های بیشتری داشته باشند */
function hubLinks(html) {
  const out = new Set();
  for (const m of String(html).matchAll(/href="((?:https?:\/\/(?:www\.)?baravard\.com)?\/[^"#\s]*)"/gi)) {
    const href = decodeEntities(m[1]);
    if (/\/pricing\/\d+\//.test(href)) continue;
    if (!/\/(pricing|brands?|cars?|price|قیمت)/i.test(href)) continue;
    try {
      out.add(new URL(href, SITE).href);
    } catch {
      /* نشانی نامعتبر */
    }
  }
  return [...out];
}

let cat = null;

/** فقط برای تست. */
export function _reset() {
  cat = null;
}

async function catalog() {
  if (cat && cat.exp > Date.now()) return cat.items;
  const items = new Map();
  const errors = [];
  const seen = new Set();
  const read = async (url) => {
    if (seen.has(url)) return null;
    seen.add(url);
    try {
      const html = await page(url, 6 * HOUR);
      for (const e of catalogFromHtml(html)) if (!items.has(e.id)) items.set(e.id, e);
      return html;
    } catch (e) {
      errors.push(e);
      return null;
    }
  };
  const hubs = [];
  for (const u of [`${SITE}/pricing`, `${SITE}/`]) {
    const html = await read(u);
    if (html) hubs.push(...hubLinks(html));
  }
  if (items.size < 30) for (const u of [...new Set(hubs)].slice(0, 8)) await read(u);
  if (!items.size) {
    if (errors.length) throw errors[0];
    throw new SourceError('فهرست خودروهای منبع دیگر خوانده نشد (احتمالاً ساختار سایت عوض شده است).');
  }
  cat = { exp: Date.now() + 6 * HOUR, items: [...items.values()] };
  return cat.items;
}

// ---------------------------------------------------------------- قیمت صفحهٔ تیپ

function jsonPrices(html) {
  const found = [];
  const walk = (n, d) => {
    if (!n || typeof n !== 'object' || d > 12) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, d + 1));
    const irr = n.priceCurrency === 'IRR' ? 'rial' : null;
    for (const k of ['lowPrice', 'highPrice', 'price', 'minPrice', 'maxPrice', 'estimatedPrice', 'min_price', 'max_price']) {
      if (n[k] !== undefined && (typeof n[k] === 'number' || typeof n[k] === 'string')) {
        const v = parseMoney(String(n[k]), irr);
        if (v) found.push({ key: k, v });
      }
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, d + 1);
  };
  for (const m of String(html).matchAll(/<script\b[^>]*(?:id="__NEXT_DATA__"|type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]), 0);
    } catch {
      /* JSON نامعتبر */
    }
  }
  return found;
}

const AMOUNT = String.raw`(\d[\d,٬.]*(?:\s*(?:میلیارد|میلیون))?(?:\s*و\s*\d[\d,٬.]*\s*میلیون)?)`;

/** صفحهٔ قیمت یک تیپ ← { low, high, price } به تومان (هر کدام ممکن است null باشد) */
export function parsePricingPage(html) {
  const json = jsonPrices(html);
  const pick = (...keys) => json.find((x) => keys.includes(x.key))?.v ?? null;
  let low = pick('lowPrice', 'minPrice', 'min_price');
  let high = pick('highPrice', 'maxPrice', 'max_price');
  let price = pick('price', 'estimatedPrice');
  if (!low && !high && !price) {
    const text = normalize(stripTags(html));
    const range = text.match(new RegExp(`${AMOUNT}\\s*(?:تومان)?\\s*(?:تا|الی|-)\\s*${AMOUNT}\\s*تومان`));
    if (range) {
      low = parseMoney(`${range[1]} تومان`);
      high = parseMoney(`${range[2]} تومان`);
    }
    if (!low || !high) {
      low = high = null;
      const one = text.match(new RegExp(`قیمت[^\\d]{0,60}${AMOUNT}\\s*تومان`));
      if (one) price = parseMoney(`${one[1]} تومان`);
    }
  }
  if (low && high && high < low) [low, high] = [high, low];
  return { low, high, price };
}

// ---------------------------------------------------------------- جستجو

export async function lookup(parsed, { canonical = null } = {}) {
  const none = (w) => ({ ...info, ok: true, matched: null, items: [], warnings: [w] });
  if (parsed.condition === 'new') return none('این منبع فقط قیمت خودروی کارکرده را دارد.');
  if (!parsed.year) return none('این منبع برای هر سال ساخت قیمت جدا دارد؛ سال خودرو را هم بگویید.');
  if (canonical?.level === 'brand') return none('برای قیمت این منبع، مدل خودرو را هم بگویید.');

  const entries = await catalog();
  const rows = entries.map((e) => ({ group: '', name: e.name, e }));
  const matched = matchRows(rows, { canon: canonical, carText: parsed.carText }).slice(0, 3);
  if (!matched.length) return none('این خودرو در منبع دیگر پیدا نشد.');

  const year = parsed.year.value;
  const items = [];
  const settled = await Promise.allSettled(
    matched.map((r) => page(`${SITE}/pricing/${r.e.id}/${r.e.slug}?model=${year}`).then((html) => ({ r, p: parsePricingPage(html) }))),
  );
  let firstErr = null;
  for (const s of settled) {
    if (s.status === 'rejected') {
      firstErr = firstErr || s.reason;
      continue;
    }
    const { r, p } = s.value;
    const value = p.low && p.high ? Math.round((p.low + p.high) / 2) : p.price;
    if (!value) continue;
    items.push({
      kind: 'list',
      priceKind: 'estimate',
      title: r.name,
      trim: '',
      year,
      price: value,
      isNew: false,
      provider: p.low && p.high ? 'برآورد قیمت (میانهٔ بازه)' : 'برآورد قیمت',
    });
  }
  if (!items.length && firstErr) throw firstErr;
  return {
    ...info,
    ok: true,
    matched: { title: canonical?.title || matched[0].name, id: matched.map((r) => r.e.id).join(',') },
    link: null,
    items,
    warnings: items.length ? [] : [`این منبع برای سال ${year} قیمتی نداشت.`],
  };
}
