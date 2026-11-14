// هماهنگ‌کننده: پرسش را تجزیه می‌کند، هر سه سایت را هم‌زمان می‌پرسد و نتیجه را ترکیب می‌کند.

import { aggregate } from './aggregate.js';
import { parseQuery } from './text.js';
import * as bama from './sources/bama.js';
import * as divar from './sources/divar.js';
import * as hamrah from './sources/hamrah.js';

export const SOURCES = [bama, divar, hamrah];
const SOURCE_TIMEOUT = 40_000;
const MAX_ITEMS = 40;

function withTimeout(promise, ms, name) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} در ${ms / 1000} ثانیه پاسخ نداد.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runSource(src, parsed, opts) {
  const t0 = Date.now();
  try {
    const r = await withTimeout(src.lookup(parsed, opts), SOURCE_TIMEOUT, src.info.name);
    return { ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { ...src.info, ok: false, error: e?.message || String(e), items: [], warnings: [], ms: Date.now() - t0 };
  }
}

/** پرسش متنی (همان چیزی که کاربر گفته) ← قیمت‌ها از همهٔ سایت‌ها و جمع‌بندی. */
export async function lookupAll(raw, opts = {}) {
  const query = parseQuery(raw);
  if (!query.carText) {
    return { query, error: 'نام خودرو تشخیص داده نشد. مثلاً بگویید: «پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰».', sources: [] };
  }
  const results = await Promise.all(SOURCES.map((s) => runSource(s, query, opts)));
  const agg = aggregate(results, query);
  const sources = results.map((r) => {
    const lists = (r.items || []).filter((i) => i.kind === 'list');
    const ads = (r.items || []).filter((i) => i.kind !== 'list');
    return { ...r, items: [...lists, ...ads.slice(0, MAX_ITEMS)], totalAds: ads.length };
  });
  return { query, ...agg, sources };
}
