// هماهنگ‌کننده: پرسش را تجزیه می‌کند، همهٔ سایت‌ها را هم‌زمان می‌پرسد و نتیجه را ترکیب می‌کند.

import { aggregate } from './aggregate.js';
import { parseQuery } from './text.js';
import * as bama from './sources/bama.js';
import * as divar from './sources/divar.js';
import * as hamrah from './sources/hamrah.js';
import * as khodro45 from './sources/khodro45.js';
import * as iranjib from './sources/iranjib.js';
import * as carir from './sources/carir.js';
import * as khodrobank from './sources/khodrobank.js';
import * as other from './sources/baravard.js';

// DISABLED_SOURCES=khodro45,carir: خاموش کردن یک یا چند منبع
const disabled = new Set(String(process.env.DISABLED_SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean));
export const SOURCES = [bama, divar, hamrah, khodro45, iranjib, carir, khodrobank, other].filter((s) => !disabled.has(s.info.id));
const SOURCE_TIMEOUT = 30_000; // سایتی که تا این زمان جواب ندهد، بی‌آن نتیجه داده می‌شود
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

/**
 * نام کامل خودرو از فهرست مدل‌های باما (کش‌شده). اگر کاربر فقط بخشی از نام را گفته باشد
 * («۲۰۶»، «سورن»، «سراتو»)، همهٔ سایت‌ها با همین نام کامل جستجو می‌شوند تا قیمت‌ها دربارهٔ یک خودرو باشند.
 */
async function canonicalize(query) {
  try {
    return await withTimeout(bama.resolveCanonical(query.carText), 12_000, bama.info.name);
  } catch {
    return null; // اگر باما در دسترس نباشد، هر سایت خودش نام را تطبیق می‌دهد
  }
}

/** پرسش متنی (همان چیزی که کاربر گفته) ← قیمت‌ها از همهٔ سایت‌ها و جمع‌بندی. */
export async function lookupAll(raw, opts = {}) {
  const query = parseQuery(raw);
  if (!query.carText) {
    return { query, error: 'نام خودرو تشخیص داده نشد. مثلاً بگویید: «پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰».', sources: [] };
  }
  const canonical = await canonicalize(query);
  const results = await Promise.all(SOURCES.map((s) => runSource(s, query, { ...opts, canonical })));
  const agg = aggregate(results, query);
  if (agg.summary && canonical?.level === 'brand') agg.summary.label += ` — همهٔ مدل‌های ${canonical.title}`;
  const sources = results.map((r) => {
    const lists = (r.items || []).filter((i) => i.kind === 'list');
    const ads = (r.items || []).filter((i) => i.kind !== 'list');
    return { ...r, items: [...lists, ...ads.slice(0, MAX_ITEMS)], totalAds: ads.length };
  });
  return { query, canonical, hints: hintsFor(canonical), ...agg, sources };
}

/** پیشنهادهای دقیق‌تر کردن جستجو وقتی کاربر فقط بخشی از نام را گفته است. */
export function hintsFor(c) {
  if (!c) return [];
  const hints = [];
  const titles = (arr) => arr.map((x) => x.title);
  if (c.level === 'brand' && c.refinements.length) {
    hints.push({ kind: 'model', text: `این قیمت برای همهٔ مدل‌های ${c.title} است. کدام مدل؟`, options: titles(c.refinements) });
  } else if (c.level === 'model' && c.refinements.length > 1) {
    hints.push({ kind: 'trim', text: `این قیمت برای همهٔ تیپ‌های ${c.title} است. برای قیمت دقیق‌تر، تیپ را انتخاب کنید:`, options: titles(c.refinements) });
  }
  if (c.alternatives.length) {
    hints.push({ kind: 'alt', text: 'شاید منظورتان یکی از این‌ها بود:', options: titles(c.alternatives) });
  }
  return hints;
}
