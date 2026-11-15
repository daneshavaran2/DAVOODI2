// دیوار (divar.ir): آگهی‌های فروش خودرو در دستهٔ «سواری و وانت».
// همان API عمومی جستجو که وب‌سایت دیوار استفاده می‌کند.

import { request, MINUTE } from '../http.js';
import { isNum, isRelevant, tokens, tokenSim } from '../match.js';
import { extractYear, normalize, parseKm, parseToman, toFaDigits } from '../text.js';

export const API = 'https://api.divar.ir';
export const WEB = 'https://divar.ir';
export const info = { id: 'divar', name: 'دیوار', url: WEB };

export const CITIES = {
  1: 'تهران', 2: 'کرج', 3: 'مشهد', 4: 'اصفهان', 5: 'تبریز', 6: 'شیراز', 7: 'اهواز', 8: 'قم',
  9: 'کرمانشاه', 10: 'ارومیه', 12: 'رشت', 13: 'کرمان', 14: 'همدان', 15: 'اراک', 16: 'یزد',
  18: 'بندرعباس', 19: 'قزوین', 22: 'ساری', 21: 'گرگان', 25: 'بوشهر',
};
export const DEFAULT_CITIES = ['1', '2', '3', '4', '5', '6'];

const PAGINATION_TYPE = 'type.googleapis.com/post_list.PaginationData';
const PAGE_SIZE = 24;
const MIN_PRICE = 50_000_000; // کمتر از این، آگهی خودرو نیست (قطعه، اجاره، ...)
const EXCLUDE = /خریدار|اجاره|کرایه|قطعات|لوازم|رینگ|لاستیک|موتورسیکلت|تصادفی/;

function search(query, cityIds, page, cursor) {
  const pagination = cursor
    ? { '@type': PAGINATION_TYPE, page, page_size: PAGE_SIZE, ...cursor }
    : { '@type': PAGINATION_TYPE, page: 1, page_size: PAGE_SIZE };
  const body = {
    city_ids: cityIds,
    search_data: { query, form_data: { data: { category: { str: { value: 'light' } } } } },
    pagination_data: pagination,
  };
  return request(`${API}/v8/postlist/w/search`, {
    method: 'POST',
    body,
    ttl: 3 * MINUTE,
    headers: { Accept: 'application/json, text/plain, */*', Origin: WEB, Referer: `${WEB}/` },
  });
}

export function parseRows(body) {
  const rows = [];
  for (const w of body?.list_widgets || []) {
    if (w?.widget_type !== 'POST_ROW' || !w.data) continue;
    const d = w.data;
    const texts = [d.top_description_text, d.middle_description_text, d.bottom_description_text].filter(Boolean);
    const priceText = texts.find((t) => /تومان|توافقی|قسط|معاوضه/.test(t)) || d.middle_description_text || '';
    const kmText = texts.find((t) => /کیلومتر|کارکرد/.test(t)) || null;
    const payload = d.action?.payload || {};
    const token = d.token || payload.token || '';
    const title = String(d.title || '').trim();
    const { price, note } = parseToman(priceText);
    const bottom = d.bottom_description_text || '';
    const mileage = parseKm(kmText);
    rows.push({
      kind: 'ad',
      priceKind: 'ad',
      token,
      title,
      year: extractYear(normalize(title)).year?.value ?? null,
      mileage,
      price,
      note,
      city: [payload.web_info?.city_persian, payload.web_info?.district_persian].filter(Boolean).join(' / '),
      time: bottom.includes(' در ') ? bottom.split(' در ')[0].trim() : bottom,
      url: token ? `${WEB}/v/${token}` : null,
      isNew: mileage === 0,
    });
  }
  return rows;
}

function nextCursor(body) {
  const pg = body?.pagination || {};
  if (!pg.has_next_page || !pg.data) return null;
  const c = { ...pg.data };
  delete c['@type'];
  delete c.search_uid;
  delete c.viewed_tokens;
  return c;
}

/**
 * آیا عنوان آگهی دربارهٔ همین خودروی کامل است؟ همهٔ کلمه‌های نام (عددها دقیق) باید باشند
 * (در نام‌های بلندِ تیپ، یک کلمهٔ غیرعددی می‌تواند نباشد)، و آگهی نباید مال مدل دقیق‌تری باشد
 * (آگهی «پژو ۲۰۶ SD» در قیمت «پژو ۲۰۶» حساب نمی‌شود).
 */
export function matchesCanonical(canon, title) {
  const tTok = tokens(title);
  const nameTok = tokens(canon.title);
  if (!nameTok.filter(isNum).every((n) => tTok.includes(n))) return false;
  const missing = nameTok.filter((w) => !isNum(w) && !tTok.some((t) => tokenSim(w, t) >= 0.7)).length;
  if (missing > (nameTok.length >= 4 ? 1 : 0)) return false;
  return !(canon.moreSpecific || []).some((s) => tokens(s).every((w) => tTok.some((t) => tokenSim(w, t) >= 0.85)));
}

export async function lookup(parsed, { cities = DEFAULT_CITIES, canonical = null } = {}) {
  // اگر نام کامل خودرو (از باما) معلوم است، با همان جستجو می‌شود؛ وگرنه با گفتهٔ کاربر
  const canon = canonical && canonical.level !== 'brand' ? canonical : null;
  const baseText = canon ? canon.title : parsed.carText;
  const qTok = tokens(baseText);
  const query = toFaDigits(baseText);
  const seen = new Set();
  const all = [];
  const run = async (q, pages) => {
    let cursor = null;
    for (let page = 1; page <= pages; page++) {
      const body = await search(q, cities, page, cursor);
      for (const r of parseRows(body)) {
        const key = r.token || r.url || r.title + r.price;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(r);
        }
      }
      cursor = nextCursor(body);
      if (!cursor) break;
    }
  };

  const keep = (r) =>
    (canon ? matchesCanonical(canon, r.title) : isRelevant(qTok, r.title)) &&
    !EXCLUDE.test(r.title) &&
    (r.price === null || r.price >= MIN_PRICE) &&
    (!parsed.year || r.year === parsed.year.value) &&
    (parsed.condition !== 'new' || r.isNew) &&
    (parsed.condition !== 'used' || !r.isNew);

  if (parsed.year) {
    await run(`${query} ${toFaDigits(parsed.year.value)}`, 2);
    if (all.filter(keep).length < 5) await run(query, 1);
  } else {
    await run(query, 2);
  }

  const items = all.filter(keep);
  const warnings = [];
  if (!items.length && all.length) warnings.push('آگهی‌ها پیدا شد ولی هیچ‌کدام دقیقاً با این خودرو و سال جور نبود.');
  const cityNames = cities.map((c) => CITIES[c]).filter(Boolean);
  return {
    ...info,
    ok: true,
    matched: { title: baseText, id: query },
    link: `${WEB}/s/iran/car?q=${encodeURIComponent(query)}`,
    cities: cityNames,
    items,
    scanned: all.length,
    warnings,
  };
}
