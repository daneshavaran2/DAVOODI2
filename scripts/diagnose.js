// بررسی از خط فرمان: npm run diagnose
// نشان می‌دهد سرور شما به هر سایت قیمت (باما، دیوار، همراه مکانیک، خودرو۴۵، ایران‌جیب، car.ir، خودروبانک) دسترسی دارد یا نه.

import { diagnose, SAMPLE_QUERY } from '../src/diagnose.js';

console.log(`پرسش نمونه: «${SAMPLE_QUERY}»\n`);
const results = await diagnose();
let okCount = 0;
for (const r of results) {
  if (r.ok && r.prices > 0) okCount++;
  const status = r.ok ? (r.prices > 0 ? 'OK ' : 'EMPTY') : 'FAIL';
  console.log(`[${status}] ${r.name.padEnd(12)} ${String(r.ms).padStart(6)}ms  قیمت‌ها: ${r.prices}  ${r.matched ? `(${r.matched})` : ''}`);
  if (r.error) console.log(`        خطا: ${r.error}`);
  for (const w of r.warnings) console.log(`        هشدار: ${w}`);
}
console.log(`\n${okCount} از ${results.length} سایت قیمت برگرداند.`);
process.exit(okCount ? 0 : 1);
