// گزارش جستجوها برای پنل مدیریت: چه گفته/نوشته شد، چه شنیده شد، چه خودرو و قیمتی برگشت.
// در DATA_DIR/searches.jsonl (هر خط یک جستجو) ذخیره و هنگام شروع خوانده می‌شود؛ قدیمی‌تر از LOG_RETENTION_DAYS
// (پیش‌فرض ۱۸۰ روز) حذف می‌شود. صدا ذخیره نمی‌شود و به جای IP فقط یک شناسهٔ یک‌طرفه (برای شمردن کاربران) می‌ماند.

import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brandsIn } from './catalog.js';
import { dataDir } from './datadir.js';
import { normalize } from './text.js';

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', hourCycle: 'h23' });
const TIME_FMT = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' });
/** روز به وقت تهران: «2026-11-17» */
export const tehranDay = (d = new Date()) => DAY_FMT.format(d);
const tehranHour = (d) => Number(HOUR_FMT.format(d));
const DAY_MS = 86_400_000;

export function createSearchLog({ dir = dataDir(), retentionDays = Number(process.env.LOG_RETENTION_DAYS) || 180, maxMemory = 50_000 } = {}) {
  const file = join(dir, 'searches.jsonl');
  let entries = []; // قدیمی ← تازه
  let persistent = false;
  let problem = null;
  let writing = Promise.resolve();
  const salt = randomBytes(16);

  async function init() {
    try {
      await mkdir(dir, { recursive: true });
      await appendFile(file, '');
      persistent = true;
    } catch (e) {
      persistent = false;
      problem = e.code || e.message;
      return status();
    }
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS).toISOString();
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    const kept = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e?.at >= cutoff) kept.push(e);
      } catch {
        // خط ناقص (مثلاً قطع برق هنگام نوشتن)
      }
    }
    entries = kept.slice(-maxMemory);
    if (kept.length !== lines.length) {
      // فشرده کردن: خط‌های قدیمی و خراب حذف
      const tmp = `${file}.tmp`;
      await writeFile(tmp, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
      await rename(tmp, file);
    }
    return status();
  }

  function status() {
    return { persistent, problem, count: entries.length, retentionDays };
  }

  /** شناسهٔ یک‌طرفهٔ کاربر (از IP؛ خود IP ذخیره نمی‌شود) */
  const userKey = (ip) => createHash('sha256').update(salt).update(String(ip || '')).digest('base64url').slice(0, 10);

  function add(e) {
    const now = new Date();
    const entry = { id: randomBytes(6).toString('base64url'), at: now.toISOString(), day: tehranDay(now), hour: tehranHour(now), ...e };
    entries.push(entry);
    if (entries.length > maxMemory) entries.splice(0, entries.length - maxMemory);
    if (persistent) {
      writing = writing.then(() => appendFile(file, `${JSON.stringify(entry)}\n`)).catch((err) => console.error('ثبت جستجو ممکن نشد:', err.message));
    }
    return entry;
  }

  const matches = (e, filter, text) => {
    if (filter === 'missed' && e.found) return false;
    if (filter === 'found' && !e.found) return false;
    if (filter === 'voice' && e.kind !== 'voice') return false;
    if (filter === 'text' && e.kind !== 'text') return false;
    if (filter === 'learned' && !e.rules?.length) return false;
    if (text) {
      const hay = normalize([e.q, e.heard, e.car, e.carText].filter(Boolean).join(' '));
      if (!hay.includes(normalize(text))) return false;
    }
    return true;
  };

  /** تازه‌ترین اول */
  function list({ offset = 0, limit = 50, filter = 'all', text = '' } = {}) {
    const out = [];
    let total = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!matches(entries[i], filter, text)) continue;
      if (total >= offset && out.length < limit) out.push(entries[i]);
      total++;
    }
    return { total, items: out };
  }

  function summary({ days = 30, now = new Date() } = {}) {
    days = Math.min(365, Math.max(1, Number(days) || 30));
    const dayList = [];
    for (let i = days - 1; i >= 0; i--) dayList.push(tehranDay(new Date(now.getTime() - i * DAY_MS)));
    const since = dayList[0];
    const today = dayList.at(-1);
    const week = tehranDay(new Date(now.getTime() - 6 * DAY_MS));
    const perDay = new Map(dayList.map((d) => [d, { day: d, total: 0, voice: 0, found: 0, users: new Set() }]));
    const hours = Array(24).fill(0);
    const cars = new Map();
    const brands = new Map();
    const missed = new Map();
    const models = new Map();
    const users = new Set();
    const totals = { today: 0, week: 0, range: 0, all: entries.length };
    let voice = 0;
    let found = 0;
    let sttSum = 0;
    let sttN = 0;
    let learned = 0;
    for (const e of entries) {
      if (e.day === today) totals.today++;
      if (e.day >= week) totals.week++;
      if (e.day < since) continue;
      totals.range++;
      const d = perDay.get(e.day);
      if (d) {
        d.total++;
        if (e.kind === 'voice') d.voice++;
        if (e.found) d.found++;
        if (e.user) d.users.add(e.user);
      }
      if (e.user) users.add(e.user);
      if (Number.isInteger(e.hour)) hours[e.hour]++;
      if (e.kind === 'voice') voice++;
      if (e.found) found++;
      if (e.rules?.length) learned++;
      if (e.stt?.ms) {
        sttSum += e.stt.ms;
        sttN++;
      }
      if (e.stt?.model) models.set(e.stt.model, (models.get(e.stt.model) || 0) + 1);
      if (e.car) {
        const c = cars.get(e.car) || { car: e.car, count: 0, found: 0, lastPrice: null, lastYear: null, lastAt: null };
        c.count++;
        if (e.found) {
          c.found++;
          if (e.price) c.lastPrice = e.price;
          c.lastYear = e.year ?? c.lastYear;
        }
        c.lastAt = e.at;
        cars.set(e.car, c);
        const brand = [...brandsIn(e.car)][0] || e.car.split(' ')[0];
        brands.set(brand, (brands.get(brand) || 0) + 1);
      }
      if (!e.found) {
        const k = normalize(e.q || '');
        const m = missed.get(k) || { q: e.q, heard: e.heard || null, count: 0, lastAt: null, error: null, id: null };
        m.count++;
        m.lastAt = e.at;
        m.error = e.error || m.error;
        m.id = e.id;
        missed.set(k, m);
      }
    }
    const top = (map, n = 15) => [...map.values()].sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, n);
    return {
      days,
      totals,
      users: users.size,
      voiceShare: totals.range ? voice / totals.range : 0,
      foundRate: totals.range ? found / totals.range : 0,
      learned,
      avgSttMs: sttN ? Math.round(sttSum / sttN) : null,
      perDay: [...perDay.values()].map((d) => ({ ...d, users: d.users.size })),
      hours,
      topCars: top(cars),
      topBrands: [...brands].map(([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count).slice(0, 12),
      missed: top(missed, 20),
      sttModels: [...models].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count),
      storage: status(),
    };
  }

  /** CSV برای Excel (UTF-8 با BOM) */
  function csv({ days = 90, now = new Date() } = {}) {
    const since = tehranDay(new Date(now.getTime() - (Math.max(1, Number(days) || 90) - 1) * DAY_MS));
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['زمان (تهران)', 'نوع', 'شنیده‌شده', 'پرسش', 'اصلاح‌شده با قاعده', 'خودرو', 'سال', 'قیمت (تومان)', 'نتیجه', 'خطا', 'مدل تبدیل گفتار', 'زمان تبدیل (ms)'];
    const rows = entries
      .filter((e) => e.day >= since)
      .map((e) => [
        TIME_FMT.format(new Date(e.at)),
        e.kind === 'voice' ? 'صوتی' : 'تایپی',
        e.heard || '',
        e.q || '',
        (e.rules || []).map((r) => `${r.from} ← ${r.to}`).join('؛ '),
        e.car || '',
        e.year ?? '',
        e.price ?? '',
        e.found ? 'پیدا شد' : 'پیدا نشد',
        e.error || '',
        e.stt?.model || '',
        e.stt?.ms ?? '',
      ]);
    return `﻿${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
  }

  return { init, add, list, summary, csv, userKey, status, flush: () => writing };
}
