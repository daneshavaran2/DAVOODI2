// خودرو۴۵ (khodro45.com): آگهی‌های خودروی کارکرده که خود خودرو۴۵ کارشناسی کرده است، با قیمت نهایی،
// سال، کارکرد و شهر. جستجو با همان API که فهرست خودروهای سایت (buy-car) از آن پر می‌شود.

import { MINUTE, request } from '../http.js';
import { isRelevant, tokens } from '../match.js';
import { toEnDigits } from '../text.js';
import { matchesCanonical } from './divar.js';

export const SITE = 'https://khodro45.com';
export const info = { id: 'khodro45', name: 'خودرو۴۵', url: SITE };

const PAGE_SIZE = 24;
const MIN_PRICE = 50_000_000;
const title = (x) => (typeof x === 'string' ? x : x?.title || x?.name || '').trim();
const slug = (x) => (typeof x === 'object' && x ? String(x.seo_slug || x.slug || '') : '').trim().toLowerCase();

/** یک صفحهٔ پاسخ (count، next، results) ← آگهی‌ها */
export function parseListing(body) {
  const results = Array.isArray(body?.results) ? body.results : [];
  return results
    .map((r) => {
      const cp = r.car_properties || {};
      const spec = r.car_specifications || {};
      const kmRaw = spec.klm ?? spec.mileage ?? spec.kilometer ?? r.klm ?? null;
      const mileage = kmRaw === null || kmRaw === '' ? null : Number(toEnDigits(String(kmRaw)).replace(/[^\d]/g, ''));
      const price = Number(r.final_price) || Number(r.price) || null;
      const cityTitle = title(r.city);
      const b = slug(cp.brand);
      const m = slug(cp.model);
      const cityEn = typeof r.city === 'object' && r.city?.title_en ? String(r.city.title_en).toLowerCase().replace(/\s+/g, '-') : '';
      const code = String(r.slug || '').toLowerCase();
      return {
        kind: 'ad',
        priceKind: 'ad',
        id: code || String(r.identifier || ''),
        title: `${title(cp.brand)} ${title(cp.model)}`.trim(),
        trim: [title(cp.trim), title(cp.option)].filter(Boolean).join(' '),
        year: Number(toEnDigits(String(cp.year ?? ''))) || null,
        mileage: Number.isFinite(mileage) ? mileage : null,
        price,
        city: cityTitle,
        time: '',
        url: b && m && cityEn && code ? `${SITE}/buy-car/${b}-${m}/${cityEn}/cla-${code}/` : null,
        isNew: mileage === 0,
      };
    })
    .filter((x) => x.title);
}

function search(text, offset) {
  const u = new URL(`${SITE}/api/v2/car_listing/`);
  u.searchParams.set('search', text);
  u.searchParams.set('limit', String(PAGE_SIZE));
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('ordering', '-created_time');
  return request(u.href, {
    ttl: 5 * MINUTE,
    headers: { Accept: 'application/json, text/plain, */*', Referer: `${SITE}/buy-car/`, Origin: SITE },
  });
}

export async function lookup(parsed, { canonical = null } = {}) {
  const canon = canonical && canonical.level !== 'brand' ? canonical : null;
  const name = canon ? canon.title : parsed.carText;
  // جستجو با نام مدل (همهٔ تیپ‌ها)، سپس صافی تیپ و سال
  const searchText = canon ? canon.modelTitle : parsed.carText;
  const qTok = tokens(name);
  const all = [];
  const seen = new Set();
  for (let page = 0; page < 2; page++) {
    const body = await search(searchText, page * PAGE_SIZE);
    for (const r of parseListing(body)) {
      const key = r.id || `${r.title}|${r.price}|${r.mileage}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(r);
      }
    }
    if (!body?.next) break;
  }

  const full = (r) => `${r.title} ${r.trim}`;
  const keep = (r) =>
    (canon ? matchesCanonical(canon, full(r)) : isRelevant(qTok, full(r))) &&
    r.price >= MIN_PRICE &&
    (!parsed.year || r.year === parsed.year.value) &&
    (parsed.condition !== 'new' || r.isNew) &&
    (parsed.condition !== 'used' || !r.isNew);
  const items = all.filter(keep);
  const warnings = [];
  if (!items.length && all.length) warnings.push('خودروهایی پیدا شد ولی هیچ‌کدام دقیقاً با این خودرو و سال جور نبود.');
  if (!all.length) warnings.push('خودرو۴۵ الان آگهی‌ای از این خودرو ندارد.');
  return {
    ...info,
    ok: true,
    matched: { title: name, id: searchText },
    link: `${SITE}/buy-car/`,
    items,
    scanned: all.length,
    warnings,
  };
}
