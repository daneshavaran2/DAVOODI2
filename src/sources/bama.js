// باما (bama.ir): فهرست قیمت روز خودروی صفر (بازار/کارخانه) و آگهی‌های فروش.
// همان APIهای JSON عمومی که خود وب‌سایت باما صدا می‌زند.

import { randomUUID } from 'node:crypto';
import { request, SourceError, MINUTE, HOUR } from '../http.js';
import { pickBest, tokens, tokenSim } from '../match.js';
import { parseKm, parseToman, toEnDigits } from '../text.js';

export const SITE = 'https://bama.ir';
export const info = { id: 'bama', name: 'باما', url: SITE };

const USER_CONTEXT = randomUUID();
const MAX_PAGES = 3; // هر صفحه حداکثر ۳۰ آگهی

function get(path, params = [], ttl = 2 * MINUTE) {
  const url = new URL(SITE + path);
  for (const [k, v] of params) if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
  return request(url.toString(), {
    ttl,
    headers: {
      Accept: '*/*',
      Referer: `${SITE}/car`,
      'x-market-name': 'Web_Desktop',
      'x-user-context': USER_CONTEXT,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    },
  });
}

/** درخت برند/مدل/تیپ باما را به فهرستی تخت تبدیل می‌کند. */
export function flattenVehicles(body) {
  const out = new Map();
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.selectable && n.value) {
        const prev = out.get(n.value);
        if (!prev || (!prev.keywords && n.keywords)) {
          out.set(n.value, { value: n.value, title: n.title || n.text || '', level: n.type, keywords: n.keywords || '' });
        }
      }
      walk(n.items);
    }
  };
  walk(body?.data);
  return [...out.values()];
}

/** نزدیک‌ترین برند/مدل/تیپ باما به متن پرسش. */
export function resolveVehicle(vehicles, carText) {
  const top = pickBest(carText, vehicles, (v) => v.title, (v) => v.keywords);
  if (!top) return null;
  let v = top.item;
  const qTok = tokens(carText);
  // اگر بخش ویژهٔ تیپ (مثلاً «V8») در پرسش نیامده، همان مدل کلی را بگیر، نه یک تیپ دلخواه
  while (v.value.split(',').length >= 3) {
    const parentValue = v.value.split(',').slice(0, -1).join(',');
    const parent = vehicles.find((x) => x.value === parentValue);
    if (!parent) break;
    const parentTok = tokens(parent.title);
    const own = tokens(v.title).filter((t) => !parentTok.includes(t));
    if (own.some((t) => qTok.some((q) => tokenSim(q, t) >= 0.7))) break;
    v = parent;
  }
  return v;
}

export function parseAds(body) {
  return (body?.data?.ads || [])
    .filter((a) => a?.type === 'ad' && a.detail)
    .map((a) => {
      const d = a.detail;
      const p = a.price || {};
      const title = String(d.title || '').replace(/،/g, '').trim();
      let { price, note } = parseToman(p.price);
      if (p.type && p.type !== 'lumpsum') {
        note = p.type === 'installment' ? 'اقساطی' : 'توافقی';
        price = null;
      }
      if (title.startsWith('حواله')) {
        note = 'حواله';
        price = null;
      }
      const year = parseInt(toEnDigits(d.year), 10) || null;
      const mileage = parseKm(d.mileage);
      return {
        kind: 'ad',
        priceKind: 'ad',
        title,
        trim: d.trim || '',
        year,
        mileage,
        price,
        note,
        city: d.location || '',
        time: d.time || '',
        url: d.url ? SITE + d.url : null,
        isNew: mileage === 0,
      };
    });
}

function providerKind(p) {
  if (/کارخانه/.test(p || '')) return 'factory';
  if (/نمایندگی/.test(p || '')) return 'dealer';
  return 'market';
}

export function parsePriceList(body) {
  const d = body?.data || {};
  const title = [d.brand_fa, d.model_fa].filter(Boolean).join(' ');
  return (d.items || [])
    .map((it) => {
      const x = it.detail || {};
      return {
        kind: 'list',
        priceKind: providerKind(x.price_provider),
        title,
        trim: x.trim_fa || '',
        year: Number(x.model_year) || null,
        price: Number(x.price) || null,
        provider: x.price_provider || '',
        change: typeof x.price_diff === 'number' ? x.price_diff : null,
        time: x.price_date || '',
        isNew: true,
      };
    })
    .filter((r) => r.price > 0);
}

async function searchAds(value, parsed) {
  const base = [
    ['vehicle', value],
    ['priced', 1],
    ['sort', 5], // جدیدترین
  ];
  if (parsed.year) base.push(['yearFrom', parsed.year.value], ['yearTo', parsed.year.value]);
  if (parsed.condition === 'new') base.push(['mileageTo', 0]);
  const ads = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await get('/cad/api/search', [...base, ['pageIndex', page]]);
    if (body?.status === false) throw new SourceError(`جستجوی باما خطا داد: ${JSON.stringify(body.errors || '')}`);
    ads.push(...parseAds(body));
    if (!body?.metadata?.has_next) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return ads;
}

async function priceList(value) {
  const [brand, model, trim] = value.split(',');
  if (!model) return [];
  const params = [
    ['brand', brand],
    ['model', model],
  ];
  if (trim) params.push(['trim', trim]);
  try {
    return parsePriceList(await get('/cad/api/price/detail', params, 30 * MINUTE));
  } catch (e) {
    if (e.status === 404 || e.status === 400) return []; // این مدل قیمت صفر ندارد (مثلاً تولیدش متوقف شده)
    throw e;
  }
}

export async function lookup(parsed) {
  const vehicles = flattenVehicles(await get('/cad/api/filter/vehicle', [], 6 * HOUR));
  if (!vehicles.length) throw new SourceError('فهرست خودروهای باما خالی برگشت.');
  const v = resolveVehicle(vehicles, parsed.carText);
  if (!v) return { ...info, ok: true, matched: null, items: [], warnings: ['این خودرو در فهرست باما پیدا نشد.'] };

  const parts = v.value.split(',');
  const warnings = [];
  if (parts.length === 1) warnings.push('فقط برند تشخیص داده شد؛ برای قیمت دقیق‌تر نام مدل را هم بگویید.');

  const [ads, prices] = await Promise.allSettled([searchAds(v.value, parsed), priceList(v.value)]);
  if (ads.status === 'rejected' && prices.status === 'rejected') throw ads.reason;
  if (ads.status === 'rejected') warnings.push(`آگهی‌ها خوانده نشد: ${ads.reason.message}`);
  if (prices.status === 'rejected') warnings.push(`فهرست قیمت صفر خوانده نشد: ${prices.reason.message}`);

  let listItems = prices.status === 'fulfilled' ? prices.value : [];
  // فهرست قیمت روز فقط برای خودروی صفر است؛ اگر سال قدیمی‌تری خواسته شده، کنار گذاشته نمی‌شود
  // ولی در جمع‌بندی همان سال به کار نمی‌رود (aggregate براساس سال گروه‌بندی می‌کند).
  if (parsed.condition === 'used') listItems = [];

  return {
    ...info,
    ok: true,
    matched: { title: v.title, id: v.value },
    link: `${SITE}/car/${parts.join('-')}`,
    priceLink: parts.length >= 2 ? `${SITE}/price/${parts[0]}` : null,
    items: [...listItems, ...(ads.status === 'fulfilled' ? ads.value : [])],
    warnings,
  };
}
