// بررسی دسترسی سرور به هر سایت با یک پرسش نمونه. خروجی برای /api/diagnose و scripts/diagnose.js.

import { lookupAll } from './lookup.js';

export const SAMPLE_QUERY = 'پژو ۲۰۶ تیپ ۲';

export async function diagnose(sample = SAMPLE_QUERY) {
  const r = await lookupAll(sample);
  return (r.sources || []).map((s) => ({
    id: s.id,
    name: s.name,
    ok: s.ok,
    ms: s.ms,
    matched: s.matched?.title || null,
    prices: (s.items || []).filter((i) => i.price > 0).length,
    error: s.error || null,
    warnings: s.warnings || [],
  }));
}
