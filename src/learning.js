// «آموزش» برنامه از پنل مدیریت: چیزهایی که مدیر یاد می‌دهد و بی‌درنگ روی همهٔ جستجوها اثر دارد.
//   - قاعدهٔ اصلاح: عبارتی که اشتباه شنیده یا نوشته می‌شود ← عبارت درست («لند کروز» ← «لندکروزر»، «بسیش» ← «پژو پارس»).
//     روی متن تبدیل‌شده از گفتار و روی جستجوی تایپی، پیش از فهمیدن نام خودرو، اعمال می‌شود.
//   - واژهٔ تازه: نام خودرویی که مدل‌های تبدیل گفتار باید بشناسند؛ به پرامپت آن‌ها، اصلاح نام نزدیک و امتیاز متن
//     اضافه می‌شود. واژه‌های «عبارت درست» قاعده‌ها هم خودکار واژه حساب می‌شوند.
// در DATA_DIR/learning.json ذخیره می‌شود (بی‌دیسک، پس از استقرار دوباره پاک می‌شود).

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from './datadir.js';
import { normalize, toFaDigits } from './text.js';

const MAX_RULES = 2000;
const MAX_WORDS = 2000;
const MAX_LEN = 120;

const state = { rules: [], words: [] };
let version = 0;
let file = null;
let saving = null;
let dirty = false;

/** نسخهٔ داده؛ با هر تغییر بالا می‌رود (برای تازه کردن واژه‌نامه) */
export const learningVersion = () => version;

export async function initLearning(dir = dataDir()) {
  file = join(dir, 'learning.json');
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    state.rules = Array.isArray(data.rules) ? data.rules.filter((r) => r?.from && r?.to) : [];
    state.words = Array.isArray(data.words) ? data.words.filter((w) => w?.word) : [];
  } catch {
    state.rules = [];
    state.words = [];
  }
  version++;
  return { rules: state.rules.length, words: state.words.length };
}

/** فقط برای آزمون */
export function _resetLearning() {
  state.rules = [];
  state.words = [];
  file = null;
  version++;
}

async function save() {
  if (!file) return;
  dirty = true;
  if (saving) return saving;
  saving = (async () => {
    while (dirty) {
      dirty = false;
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(tmp, JSON.stringify({ rules: state.rules, words: state.words }, null, 1));
        await rename(tmp, file);
      } catch (e) {
        console.error('ذخیرهٔ آموزش ممکن نشد:', e.message);
      }
    }
    saving = null;
  })();
  return saving;
}
/** برای آزمون: صبر تا ذخیره تمام شود */
export const _flushLearning = () => saving || Promise.resolve();

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => normalize(s);

function check(text, what) {
  const t = clean(text);
  if (!t) throw new Error(`${what} خالی است.`);
  if (t.length > MAX_LEN) throw new Error(`${what} بیش از ${MAX_LEN} نویسه است.`);
  if (!key(t)) throw new Error(`${what} حرف یا عددی ندارد.`);
  return t;
}

export function listLearning() {
  return { rules: state.rules.map((r) => ({ ...r })), words: state.words.map((w) => ({ ...w })) };
}

/** قاعدهٔ تازه؛ اگر برای همان عبارت قاعده‌ای هست، به‌روز می‌شود */
export function addRule(from, to, note = '') {
  const f = check(from, 'عبارت اشتباه');
  const t = check(to, 'عبارت درست');
  if (key(f) === key(t)) throw new Error('عبارت اشتباه و درست یکی‌اند.');
  let rule = state.rules.find((r) => key(r.from) === key(f));
  if (rule) Object.assign(rule, { to: t, enabled: true, updatedAt: new Date().toISOString() });
  else {
    if (state.rules.length >= MAX_RULES) throw new Error('تعداد قاعده‌ها به سقف رسیده است.');
    rule = { id: randomBytes(6).toString('base64url'), from: f, to: t, enabled: true, hits: 0, note: clean(note).slice(0, 200), at: new Date().toISOString() };
    state.rules.push(rule);
  }
  version++;
  save();
  return { ...rule };
}

export function updateRule(id, { enabled, to } = {}) {
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return null;
  if (typeof enabled === 'boolean') rule.enabled = enabled;
  if (to !== undefined) rule.to = check(to, 'عبارت درست');
  rule.updatedAt = new Date().toISOString();
  version++;
  save();
  return { ...rule };
}

export function removeRule(id) {
  const n = state.rules.length;
  state.rules = state.rules.filter((r) => r.id !== id);
  if (state.rules.length === n) return false;
  version++;
  save();
  return true;
}

export function addWord(word) {
  const w = check(word, 'واژه');
  if (!state.words.some((x) => key(x.word) === key(w))) {
    if (state.words.length >= MAX_WORDS) throw new Error('تعداد واژه‌ها به سقف رسیده است.');
    state.words.push({ word: w, at: new Date().toISOString() });
    version++;
    save();
  }
  return { word: w };
}

export function removeWord(word) {
  const n = state.words.length;
  state.words = state.words.filter((x) => key(x.word) !== key(word));
  if (state.words.length === n) return false;
  version++;
  save();
  return true;
}

/** واژه‌های یادگرفته: واژه‌های تازه + کلمه‌های «عبارت درست» قاعده‌های روشن (برای پرامپت و واژه‌نامه) */
export function learnedWords() {
  const out = new Set();
  for (const w of state.words) out.add(clean(w.word));
  for (const r of state.rules) if (r.enabled) out.add(clean(r.to));
  return [...out];
}

/**
 * قاعده‌های روشن را روی متن اعمال می‌کند (کلمه‌به‌کلمه، عبارت بلندتر اول). خروجی { text, applied }.
 * اگر قاعده‌ای نخورد، همان متن اصلی برمی‌گردد.
 */
export function applyRules(text, { count = true } = {}) {
  const rules = state.rules.filter((r) => r.enabled).sort((a, b) => key(b.from).length - key(a.from).length);
  if (!rules.length || !text) return { text, applied: [] };
  let t = ` ${key(text)} `;
  const applied = [];
  for (const r of rules) {
    const f = ` ${key(r.from)} `;
    if (!t.includes(f)) continue;
    // عبارت درست از قبل هست («پارس» ← «پژو پارس» روی «پژو پارس»): دوباره اعمال نشود
    if (t.includes(` ${key(r.to)} `)) continue;
    t = t.split(f).join(` ${key(r.to)} `);
    applied.push({ id: r.id, from: r.from, to: r.to });
    if (count) r.hits = (r.hits || 0) + 1;
  }
  if (!applied.length) return { text, applied };
  if (count) save();
  return { text: toFaDigits(t.trim()), applied };
}
