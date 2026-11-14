// همراه مکانیک (hamrah-mechanic.com): قیمت روز بازار هر خودرو به تفکیک تیپ و سال ساخت
// (هم صفر و هم کارکرده). داده‌ها از صفحه‌های Next.js خود سایت (_next/data) خوانده می‌شود.

import { request, SourceError, HOUR } from '../http.js';
import { fold, isNum, leftoverTokens, pickBest, scoreCandidate, tokens, tokenSim } from '../match.js';

export const SITE = 'https://www.hamrah-mechanic.com';
export const info = { id: 'hamrah', name: 'همراه مکانیک', url: SITE };

const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
};

// خودروهای ساخت ایران زیر نام خودروساز قرار دارند (پژو 206 ← ایران خودرو).
const MAKERS = {
  پژو: ['irankhodro', 'peugeot'], سمند: ['irankhodro'], دنا: ['irankhodro'], رانا: ['irankhodro'],
  تارا: ['irankhodro'], سورن: ['irankhodro'], هایما: ['irankhodro'], اریسان: ['irankhodro'], ریرا: ['irankhodro'],
  پراید: ['saipa'], تیبا: ['saipa'], ساینا: ['saipa'], کوییک: ['saipa'], شاهین: ['saipa'], اطلس: ['saipa'],
  اریو: ['saipa'], سراتو: ['saipa', 'kia'], ریو: ['saipa', 'kia'], نیسان: ['zamyad', 'nissan'], زامیاد: ['zamyad'],
};

let build = null;

/** فقط برای تست. */
export function _reset() {
  build = null;
}

async function buildId(force = false) {
  if (!force && build && build.exp > Date.now()) return build.id;
  const html = await request(`${SITE}/`, { as: 'text', headers: PAGE_HEADERS, timeout: 20000 });
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new SourceError('نسخهٔ صفحه‌های همراه مکانیک خوانده نشد (احتمالاً ساختار سایت عوض شده است).');
  build = { id: m[1], exp: Date.now() + HOUR };
  return build.id;
}

async function nextData(page, ttl = HOUR) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = await buildId(attempt > 0);
    try {
      const body = await request(`${SITE}/_next/data/${id}/${page}.json`, {
        ttl,
        headers: { Accept: '*/*', Referer: `${SITE}/`, 'x-nextjs-data': '1' },
      });
      return body?.pageProps || {};
    } catch (e) {
      // بعد از هر استقرار جدید سایت، buildId عوض می‌شود و آدرس قبلی 404 می‌دهد
      if (e.status === 404 && attempt === 0) continue;
      throw e;
    }
  }
  return {};
}

const slug = (s) => String(s || '').trim().toLowerCase();

/** فهرست مدل‌ها از جدول قیمت روز خودروهای داخلی و خارجی. */
export function catalogFromPriceLists(...pages) {
  const models = new Map();
  for (const pp of pages) {
    for (const b of pp?.pricesList || []) {
      for (const c of b.carPriceDetailsDtos || []) {
        const brand = slug(c.brandEnglishName || b.brandEnglishName);
        const model = slug(c.modelEnglishName);
        if (!brand || !model) continue;
        const key = `${brand}/${model}`;
        if (!models.has(key)) models.set(key, { brand, model, name: String(c.modelName || c.nickName || '').trim() });
      }
    }
  }
  return [...models.values()];
}

export function catalogFromBrandPage(pp, brandSlug) {
  return (pp?.modelsCardList || [])
    .filter((c) => c.modelEnglishName)
    .map((c) => ({
      brand: slug(c.mainBrandEnglishName || brandSlug),
      model: slug(c.modelEnglishName),
      name: String(c.carName || '').trim(),
    }));
}

async function frontCatalog() {
  const [dom, imp] = await Promise.allSettled([
    nextData('carprice/dakheli', 6 * HOUR),
    nextData('carprice/khareji', 6 * HOUR),
  ]);
  if (dom.status === 'rejected' && imp.status === 'rejected') throw dom.reason;
  return catalogFromPriceLists(
    dom.status === 'fulfilled' ? dom.value : null,
    imp.status === 'fulfilled' ? imp.value : null,
  );
}

async function brandCatalog(qTok) {
  const brands = (await nextData('cars-for-sale', 12 * HOUR)).brands || [];
  const slugs = new Set();
  for (const b of brands) {
    const nameTok = tokens(b.brandName || '');
    if (nameTok.length && nameTok.every((t) => qTok.some((q) => tokenSim(q, t) >= 0.85))) slugs.add(slug(b.brandEnglishName));
  }
  for (const q of qTok) {
    for (const [k, v] of Object.entries(MAKERS)) if (tokenSim(q, fold(k)) >= 0.85) v.forEach((s) => slugs.add(s));
  }
  const list = [...slugs].slice(0, 3);
  const pages = await Promise.allSettled(list.map((s) => nextData(`carprice/${s}`, 6 * HOUR)));
  return pages.flatMap((p, i) => (p.status === 'fulfilled' ? catalogFromBrandPage(p.value, list[i]) : []));
}

export function parseModelPage(pp, fallbackName = '') {
  const pl = pp?.yearsPriceList || {};
  const title = pp?.modelDetail?.nickName || fallbackName;
  const rows = (pl.carPriceOtherYearsDetails || [])
    .map((r) => ({
      kind: 'list',
      priceKind: 'market',
      title,
      trim: String(r.carTypeName || '').trim(),
      year: Number(r.carYear) || null,
      price: Number(r.marketPrice) || null,
      zero: r.existPriceZero === true,
    }))
    .filter((r) => r.price > 0);
  const maxYear = Math.max(0, ...rows.map((r) => r.year || 0));
  for (const r of rows) {
    r.isNew = r.zero && r.year === maxYear;
    delete r.zero;
  }
  return { title, updated: pl.lastUpdateTime || null, rows };
}

/** اگر در پرسش تیپ آمده (تیپ 2، اتوماتیک، ...)، فقط همان تیپ‌ها. */
export function filterTrims(rows, qTok, modelName) {
  const left = leftoverTokens(qTok, modelName);
  if (!left.length) return { rows, trimMatched: null };
  let bestScore = 0;
  const scored = rows.map((r) => {
    const s = scoreCandidate(left, tokens(r.trim))?.score || 0;
    bestScore = Math.max(bestScore, s);
    return [r, s];
  });
  if (!bestScore) return { rows, trimMatched: false };
  return { rows: scored.filter(([, s]) => s >= bestScore - 1e-9).map(([r]) => r), trimMatched: true };
}

export async function lookup(parsed) {
  const qTok = tokens(parsed.carText);
  let top = null;
  let firstErr = null;
  try {
    top = pickBest(qTok, await frontCatalog(), (m) => m.name);
  } catch (e) {
    firstErr = e;
  }
  // مدل‌های قدیمی (مثل پراید) در جدول روز نیستند؛ صفحهٔ برند را هم نگاه کن
  const missesModelNumber = (t) =>
    qTok.some((n) => isNum(n) && n.length >= 3 && !tokens(t.item.name).includes(n));
  if (!top || top.precision < 1 || missesModelNumber(top)) {
    try {
      const alt = pickBest(qTok, await brandCatalog(qTok), (m) => m.name);
      if (alt && (!top || alt.score > top.score)) top = alt;
    } catch (e) {
      firstErr = firstErr || e;
    }
  }
  if (!top) {
    if (firstErr) throw firstErr;
    return { ...info, ok: true, matched: null, items: [], warnings: ['این خودرو در همراه مکانیک پیدا نشد.'] };
  }

  const m = top.item;
  const page = parseModelPage(await nextData(`carprice/${m.brand}/${m.model}`), m.name);
  const warnings = [];
  const { rows: trimRows, trimMatched } = filterTrims(page.rows, qTok, m.name);
  if (trimMatched === false) warnings.push('تیپ گفته‌شده در همراه مکانیک پیدا نشد؛ همهٔ تیپ‌ها آمده است.');

  let items = trimRows;
  if (parsed.year) {
    items = trimRows.filter((r) => r.year === parsed.year.value);
    if (!items.length) {
      const years = [...new Set(trimRows.map((r) => r.year))].sort((a, b) => b - a);
      warnings.push(`همراه مکانیک برای سال ${parsed.year.value} قیمتی ندارد. سال‌های موجود: ${years.join('، ') || '—'}`);
    }
  }
  if (parsed.condition === 'new') items = items.filter((r) => r.isNew);
  if (parsed.condition === 'used') items = items.filter((r) => !r.isNew);

  return {
    ...info,
    ok: true,
    matched: { title: page.title || m.name, id: `${m.brand}/${m.model}` },
    link: `${SITE}/carprice/${m.brand}/${m.model}/`,
    updated: page.updated,
    items,
    warnings,
  };
}
