// حافظه‌ای که برنامه واقعاً در اختیار دارد: سقف cgroup در کانتینر (مثلاً پلن لیارا)، وگرنه کل RAM.

import { readFile } from 'node:fs/promises';
import { totalmem } from 'node:os';

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

/** آیا حافظه برای اجرای whisper کافی است؟ minMB = 0 یعنی بررسی نشود. limitMB: اگر از پیش معلوم است. */
export async function memoryStatus(minMB, limitMB = null) {
  limitMB = limitMB || Math.round((await memoryLimitBytes()) / 1024 / 1024);
  return { limitMB, minMB, ok: !minMB || limitMB >= minMB };
}
