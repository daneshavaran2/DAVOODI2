// حافظه‌ای که برنامه واقعاً در اختیار دارد: سقف cgroup در کانتینر (مثلاً پلن لیارا)، وگرنه کل RAM.

import { readFile } from 'node:fs/promises';
import { availableParallelism, cpus, totalmem } from 'node:os';

const CGROUP_FILES = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'];

let cached = null;

export async function memoryLimitBytes() {
  if (cached !== null) return cached;
  let limit = totalmem();
  for (const f of CGROUP_FILES) {
    try {
      const t = (await readFile(f, 'utf8')).trim();
      const n = Number(t);
      if (t !== 'max' && Number.isFinite(n) && n > 0 && n < limit) limit = n; // «max» یا عدد خیلی بزرگ یعنی بدون سقف
      break;
    } catch {}
  }
  cached = limit;
  return limit;
}

let cpuCached = null;

/**
 * سهم پردازندهٔ برنامه (مثلاً ۱ یا ۰٫۵ هسته در پلن لیارا)، از سقف cgroup. os.cpus() همهٔ هسته‌های سرور را
 * نشان می‌دهد، نه سهم کانتینر را؛ اجرای whisper با رشته‌های بیشتر از سهم، در آزمایش دو برابر کندتر بود.
 */
export async function cpuLimit() {
  if (cpuCached !== null) return cpuCached;
  const host = availableParallelism?.() ?? cpus().length;
  let limit = host;
  try {
    const [q, p] = (await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim().split(/\s+/);
    if (q !== 'max' && Number(q) > 0 && Number(p) > 0) limit = Math.min(host, Number(q) / Number(p));
  } catch {
    try {
      const q = Number(await readFile('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'));
      const p = Number(await readFile('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'));
      if (q > 0 && p > 0) limit = Math.min(host, q / p);
    } catch {}
  }
  cpuCached = Math.round(limit * 100) / 100;
  return cpuCached;
}

let cpuInfoCached = null;
/** نام و توان پردازندهٔ سرور (برای عیب‌یابی سرعت تبدیل گفتار): AMX و AVX-512 سرعت را چند برابر می‌کنند */
export async function cpuInfo() {
  if (cpuInfoCached) return cpuInfoCached;
  let model = cpus()[0]?.model || null;
  let flags = [];
  try {
    const t = await readFile('/proc/cpuinfo', 'utf8');
    model = (t.match(/^model name\s*:\s*(.+)$/m) || [])[1]?.trim() || model;
    const f = ` ${(t.match(/^flags\s*:\s*(.+)$/m) || [])[1] || ''} `;
    flags = ['avx2', 'avx512f', 'amx_int8'].filter((x) => f.includes(` ${x} `));
  } catch {}
  cpuInfoCached = { model, flags };
  return cpuInfoCached;
}

/** آیا حافظه برای اجرای whisper کافی است؟ minMB = 0 یعنی بررسی نشود. limitMB: اگر از پیش معلوم است. */
export async function memoryStatus(minMB, limitMB = null) {
  limitMB = limitMB || Math.round((await memoryLimitBytes()) / 1024 / 1024);
  return { limitMB, minMB, ok: !minMB || limitMB >= minMB };
}
