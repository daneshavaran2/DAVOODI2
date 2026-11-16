// هماهنگ‌کننده: پرسش را تجزیه می‌کند، همهٔ سایت‌ها را هم‌زمان می‌پرسد و نتیجه را ترکیب می‌کند.

import { aggregate, quantile } from './aggregate.js';
import { parseQuery, toFaDigits } from './text.js';
import { MODEL_NUMBERS } from './catalog.js';
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
  const example = 'مثلاً بگویید: «پژو ۲۰۶ تیپ ۲ مدل ۱۴۰۰».';
  if (!query.carText) {
    // فقط سال شنیده شد («۲۰۲۶»، «مدل ۱۴۰۴»): نام خودرو را بپرس، نه قیمتِ هر آگهی‌ای که این عدد را دارد
    const error = query.year
      ? `سال ${toFaDigits(query.year.value)} را شنیدم، ولی نام خودرو را نه. نام خودرو را هم بگویید؛ مثلاً «لندکروزر مدل ${toFaDigits(query.year.value)}».`
      : `نام خودرو تشخیص داده نشد. ${example}`;
    return { query, error, sources: [] };
  }
  const canonical = await canonicalize(query);
  // فقط عدد گفته شد و آن عدد نام هیچ مدلی نیست («۹۸»، «۲۵۰۰۰»): جستجوی آگهی‌های اتفاقی نه
  const tok = query.carText.split(' ');
  if (!canonical && tok.every((t) => /^\d+$/.test(t)) && !tok.some((t) => MODEL_NUMBERS.has(t))) {
    return { query, error: `«${toFaDigits(query.carText)}» نام خودرو نیست. ${example}`, sources: [] };
  }
  const results = await Promise.all(SOURCES.map((s) => runSource(s, query, { ...opts, canonical })));
  dropUnrealPrices(results);
  const agg = aggregate(results, query);
  if (agg.summary && canonical?.level === 'brand') agg.summary.label += ` — همهٔ مدل‌های ${canonical.title}`;
  const sources = results.map((r) => {
    const lists = (r.items || []).filter((i) => i.kind === 'list');
    const ads = (r.items || []).filter((i) => i.kind !== 'list');
    return { ...r, items: [...lists, ...ads.slice(0, MAX_ITEMS)], totalAds: ads.length };
  });
  return { query, canonical, hints: hintsFor(canonical), ...agg, sources };
}

// قیمت غیرواقعی: کمتر از این هیچ خودرویی نیست (آگهی با قیمت «۱»، «۱ میلیون» یا قیمت قطعه)
export const MIN_CAR_PRICE = Number(process.env.MIN_CAR_PRICE) || 100_000_000;
// و قیمتی که بیش از ۱۰ برابر از میانهٔ همهٔ قیمت‌های همین خودرو (همهٔ سال‌ها و سایت‌ها) کمتر یا بیشتر است
const UNREAL_FACTOR = 10;

/**
 * قیمت‌های غیرواقعی پیش از محاسبه و نمایش کنار گذاشته می‌شوند (حذف داده‌های پرتِ هر سایت فقط با دست‌کم ۵ قیمت
 * کار می‌کند؛ یک آگهی تنها با قیمت «۱ میلیون» از آن رد می‌شد). در هشدارهای همان سایت تعدادشان گفته می‌شود.
 */
export function dropUnrealPrices(results) {
  const prices = results
    .filter((r) => r?.ok)
    .flatMap((r) => (r.items || []).filter((i) => i.price >= MIN_CAR_PRICE).map((i) => i.price))
    .sort((a, b) => a - b);
  const median = prices.length ? quantile(prices, 0.5) : null;
  const unreal = (p) => p < MIN_CAR_PRICE || (median && (p > median * UNREAL_FACTOR || p < median / UNREAL_FACTOR));
  for (const r of results) {
    if (!r?.ok || !r.items?.length) continue;
    const kept = r.items.filter((i) => !(i.price > 0) || !unreal(i.price));
    const dropped = r.items.length - kept.length;
    if (!dropped) continue;
    r.items = kept;
    r.warnings = [...(r.warnings || []), `${toFaDigits(dropped)} قیمت غیرواقعی (مثلاً «۱ میلیون») کنار گذاشته شد و در برآورد حساب نشد.`];
  }
  return results;
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
