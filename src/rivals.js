// خودروهای هم‌رده: از صفحهٔ «رقبا»ی منبع دیگر (هم‌رده به انتخاب خود آن سایت)؛ اگر نبود، خودروهای صفری
// که قیمت روزشان نزدیک به همین خودرو است (از جدول‌های قیمت روز). قیمت هر کدام از جدول‌های قیمت روز.

import { parseQuery } from './text.js';
import { isRelevant, tokens } from './match.js';
import { quantile } from './aggregate.js';
import * as bama from './sources/bama.js';
import * as other from './sources/baravard.js';
import * as iranjib from './sources/iranjib.js';
import * as carir from './sources/carir.js';
import * as khodrobank from './sources/khodrobank.js';
import { isCurrentYear, matchRows } from './sources/pricetable.js';

const MAX = 8;
const NEAR = 0.15; // ±۱۵٪ قیمت

const within = (p, ms, name) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${name}: دیر شد`)), ms))]);

async function tableRows() {
  const all = await Promise.allSettled([iranjib, carir, khodrobank].map((s) => within(s.rows(), 25_000, s.info.name)));
  return all.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).filter((r) => r.market > 0 && isCurrentYear(r.year));
}

/** قیمت روز صفر کیلومتر یک خودرو از جدول‌ها (میانهٔ سطرهای جورشده) */
export function zeroPrice(rows, name) {
  const m = matchRows(rows, { carText: name });
  const v = m.map((r) => r.market).sort((a, b) => a - b);
  return v.length ? Math.round(quantile(v, 0.5)) : null;
}

/** خودروهای صفری با قیمت نزدیک به ref، هر مدل یک بار، نزدیک‌ترین اول */
export function similarPriced(rows, ref, selfName) {
  const selfTok = tokens(selfName);
  const byModel = new Map();
  for (const r of rows) {
    if (Math.abs(r.market - ref) / ref > NEAR) continue;
    const text = `${r.group} ${r.name}`;
    if (selfTok.length && isRelevant(selfTok, text, 1)) continue; // خود همین خودرو
    const key = tokens(r.name).slice(0, 2).join(' '); // «پژو 206 تیپ 2» و «پژو 206 تیپ 5» یک مدل‌اند
    const prev = byModel.get(key);
    if (!prev || Math.abs(r.market - ref) < Math.abs(prev.price - ref)) byModel.set(key, { name: r.name, price: r.market });
  }
  return [...byModel.values()].sort((a, b) => Math.abs(a.price - ref) - Math.abs(b.price - ref)).slice(0, MAX);
}

/**
 * raw: نام خودرو (همان پرسش کاربر). ref: قیمت صفر این خودرو اگر معلوم است (برای روش «هم‌قیمت»).
 * خروجی: { car, basis: 'class' | 'price' | null, rivals: [{ name, price }] }
 */
export async function findRivals(raw, { ref = null } = {}) {
  const query = parseQuery(raw);
  if (!query.carText) return { error: 'نام خودرو تشخیص داده نشد.', rivals: [] };
  const canonical = await within(bama.resolveCanonical(query.carText), 12_000, 'باما').catch(() => null);
  const car = canonical?.title || query.carText;
  const [rows, opp] = await Promise.all([
    tableRows().catch(() => []),
    within(other.opponents({ canonical, carText: query.carText }), 25_000, 'هم‌رده').catch(() => []),
  ]);

  let basis = null;
  let rivals = [];
  if (opp.length) {
    basis = 'class';
    rivals = opp.slice(0, MAX).map((o) => ({ name: o.name, price: o.price || zeroPrice(rows, o.name) }));
  } else {
    const refPrice = ref > 0 ? ref : zeroPrice(rows, car);
    if (refPrice) {
      basis = 'price';
      rivals = similarPriced(rows, refPrice, car);
    }
  }
  return { car, basis, rivals };
}
