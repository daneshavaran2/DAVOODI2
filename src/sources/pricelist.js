// منبع «جدول قیمت روز»: سایت‌هایی که یک یا چند صفحه با جدول قیمت بازار و کارخانهٔ خودروهای صفر دارند.
// صفحه‌ها یک بار در ساعت خوانده می‌شوند؛ اگر نشانی صفحهٔ قیمت عوض شده باشد، از پیوند «قیمت خودرو»
// در صفحهٔ اول سایت پیدا می‌شود. نشانی صفحه‌ها را می‌توان با متغیر محیطی هم داد (مثلاً CARIR_URLS).

import { HOUR, request, SourceError } from '../http.js';
import { extractRows, isCurrentYear, matchRows, priceLinks } from './pricetable.js';

const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.5',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'upgrade-insecure-requests': '1',
};

/**
 * id، name: شناسه و نام سایت. site: نشانی اصلی. pages: صفحه‌های قیمت (به ترتیب).
 * discover: اگر صفحه‌ها جدولی نداشتند، پیوند صفحهٔ قیمت از صفحهٔ اول پیدا شود.
 * envVar: متغیر محیطی برای دادن نشانی صفحه‌ها (جداشده با کاما).
 */
export function createPriceListSource({ id, name, site, pages = [], discover = true, envVar = null }) {
  const info = { id, name, url: site };
  let loaded = null;

  async function fetchHtml(url, errors) {
    try {
      return await request(url, { as: 'text', headers: PAGE_HEADERS, ttl: HOUR, timeout: 20000 });
    } catch (e) {
      errors.push(e);
      return null;
    }
  }

  async function load() {
    if (loaded && loaded.exp > Date.now()) return loaded;
    const fromEnv = envVar && process.env[envVar] ? process.env[envVar].split(',').map((s) => s.trim()).filter(Boolean) : null;
    const errors = [];
    const rows = [];
    const used = [];
    const read = async (url) => {
      const html = await fetchHtml(url, errors);
      if (!html) return;
      const r = extractRows(html);
      if (r.length) {
        rows.push(...r);
        used.push(url);
      }
    };
    for (const u of fromEnv || pages) await read(u);
    if (!rows.length && discover) {
      const home = await fetchHtml(`${site}/`, errors);
      if (home) {
        rows.push(...extractRows(home));
        if (rows.length) used.push(`${site}/`);
        for (const u of priceLinks(home, `${site}/`).filter((u) => !used.includes(u)).slice(0, 3)) await read(u);
      }
    }
    if (!rows.length) {
      if (errors.length) throw errors[0];
      throw new SourceError(`جدول قیمتی در ${name} پیدا نشد (احتمالاً ساختار صفحه عوض شده است).`);
    }
    loaded = { exp: Date.now() + HOUR, rows, pages: used };
    return loaded;
  }

  async function lookup(parsed, { canonical = null } = {}) {
    if (canonical?.level === 'brand') {
      return { ...info, ok: true, matched: null, items: [], warnings: [`${name} قیمت هر مدل را جدا دارد؛ برای قیمت دقیق، مدل خودرو را هم بگویید.`] };
    }
    const { rows, pages: used } = await load();
    const canon = canonical || null;
    const matched = matchRows(rows, { canon, carText: parsed.carText });
    if (!matched.length) {
      return { ...info, ok: true, matched: null, link: used[0], items: [], warnings: [`این خودرو در جدول قیمت ${name} پیدا نشد.`] };
    }

    let items = [];
    for (const r of matched) {
      const base = { kind: 'list', title: r.name, trim: '', year: r.year, isNew: isCurrentYear(r.year) };
      if (r.market) items.push({ ...base, priceKind: 'market', price: r.market, provider: 'قیمت بازار' });
      if (r.factory) items.push({ ...base, priceKind: 'factory', price: r.factory, provider: 'قیمت کارخانه' });
    }

    const warnings = [];
    if (parsed.year) {
      const y = parsed.year.value;
      items = items.filter((i) => i.year === y || (!i.year && isCurrentYear(y)));
    }
    if (parsed.condition === 'new') items = items.filter((i) => i.isNew);
    if (parsed.condition === 'used') items = items.filter((i) => !i.isNew);
    if (!items.length && matched.length) warnings.push(`${name} فقط قیمت روز خودروی صفر کیلومتر را دارد.`);

    return {
      ...info,
      ok: true,
      matched: { title: canon?.title || matched[0].name, id: used[0] },
      link: used[0],
      items,
      warnings,
    };
  }

  return {
    info,
    lookup,
    _reset() {
      loaded = null;
    },
  };
}
