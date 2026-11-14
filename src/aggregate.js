// ترکیب قیمت‌های چند سایت: دسته‌بندی به «صفر» و «سال ساخت»، حذف داده‌های پرت،
// میانهٔ هر سایت، و برآورد نهایی (میانهٔ میانه‌ها).

import { currentJalaliYear } from './text.js';

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** آمار با حذف داده‌های پرت (روش IQR) وقتی دست‌کم ۵ قیمت داریم. */
export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  let t = v;
  if (v.length >= 5) {
    const q1 = quantile(v, 0.25);
    const q3 = quantile(v, 0.75);
    const iqr = q3 - q1;
    t = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  }
  return {
    count: v.length,
    outliers: v.length - t.length,
    min: t[0],
    max: t[t.length - 1],
    median: Math.round(quantile(t, 0.5)),
    p25: Math.round(quantile(t, 0.25)),
    p75: Math.round(quantile(t, 0.75)),
  };
}

const KIND_LABEL = { ad: 'آگهی', market: 'قیمت بازار', dealer: 'قیمت نمایندگی' };

/** ترکیب آمار سایت‌های مختلف برای یک گروه (صفر یا یک سال). */
export function combine(perSource) {
  const sources = perSource.filter((s) => s.stats);
  if (!sources.length) return null;
  const medians = sources.map((s) => s.stats.median).sort((a, b) => a - b);
  const one = sources.length === 1 ? sources[0].stats : null;
  return {
    estimate: Math.round(quantile(medians, 0.5)),
    low: one ? one.p25 : medians[0],
    high: one ? one.p75 : medians[medians.length - 1],
    count: sources.reduce((n, s) => n + s.stats.count, 0),
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      basis: s.basis,
      median: s.stats.median,
      min: s.stats.min,
      max: s.stats.max,
      count: s.stats.count,
    })),
  };
}

function groupKey(item) {
  if (item.isNew) return 'new';
  return Number.isFinite(item.year) ? item.year : null;
}

/**
 * results: خروجی lookup هر سایت. parsed: خروجی parseQuery.
 * خروجی: { summary, newCar, byYear, factory }
 */
export function aggregate(results, parsed, now = new Date()) {
  // groups: key -> sourceId -> { info, prices[], kinds:Set }
  const groups = new Map();
  const factory = [];
  for (const r of results) {
    if (!r?.ok) continue;
    for (const it of r.items || []) {
      if (!(it.price > 0)) continue;
      if (it.priceKind === 'factory') {
        factory.push({ source: r.name, trim: it.trim, year: it.year, price: it.price, time: it.time || '' });
        continue;
      }
      const key = groupKey(it);
      if (key === null) continue;
      if (!groups.has(key)) groups.set(key, new Map());
      const g = groups.get(key);
      if (!g.has(r.id)) g.set(r.id, { id: r.id, name: r.name, prices: [], kinds: new Set() });
      const e = g.get(r.id);
      e.prices.push(it.price);
      e.kinds.add(it.priceKind);
    }
  }

  const build = (key) => {
    const g = groups.get(key);
    if (!g) return null;
    const c = combine(
      [...g.values()].map((e) => ({
        id: e.id,
        name: e.name,
        basis: [...e.kinds].map((k) => KIND_LABEL[k] || k).join('، '),
        stats: stats(e.prices),
      })),
    );
    return c && { key, ...c };
  };

  const newCar = build('new');
  const years = [...groups.keys()].filter((k) => k !== 'new').sort((a, b) => b - a);
  const byYear = years.map(build).filter(Boolean).slice(0, 25);

  let summary = null;
  let label = '';
  const cj = currentJalaliYear(now);
  if (parsed.year) {
    const y = parsed.year.value;
    summary = byYear.find((r) => r.key === y) || null;
    label = `مدل ${y}`;
    // سال خواسته‌شده تازه است (در همان تقویم) و کاربر «کارکرده» نخواسته ← قیمت صفر کیلومتر
    const recent = parsed.year.calendar === 'gregorian' ? y >= now.getFullYear() - 1 : y >= cj - 1;
    if (!summary && newCar && recent && parsed.condition !== 'used') {
      summary = newCar;
      label = `مدل ${y} (صفر کیلومتر)`;
    }
  } else if (parsed.condition !== 'used' && newCar) {
    summary = newCar;
    label = 'صفر کیلومتر';
  } else if (byYear.length) {
    // بدون سال: سالی که بیشترین داده را دارد (رایج‌ترین در بازار)
    summary = [...byYear].sort((a, b) => b.count - a.count || b.key - a.key)[0];
    label = `مدل ${summary.key} (رایج‌ترین سال در داده‌ها)`;
  }

  factory.sort((a, b) => (b.year || 0) - (a.year || 0) || a.price - b.price);
  return {
    summary: summary ? { ...summary, label } : null,
    newCar,
    byYear,
    factory,
  };
}
