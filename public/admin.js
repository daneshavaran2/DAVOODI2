// پنل مدیریت: ورود، خلاصه و نمودارها، فهرست جستجوها، آموزش (قاعده‌های اصلاح، واژه‌ها، آزمون جمله).
// همهٔ متن‌های کاربران با esc() یا textContent نوشته می‌شوند.

const $ = (s, el = document) => el.querySelector(s);
const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (v) => String(v ?? '').replace(/\d/g, (d) => FA[d]);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('fa-IR');
const dayFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', weekday: 'short', month: 'long', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
// «2026-11-17» (روز تهران) ← تاریخ؛ ظهر همان روز تا منطقهٔ زمانی روز را عوض نکند
const dayDate = (d) => new Date(`${d}T12:00:00+03:30`);
const pct = (x) => `${fa(Math.round((x || 0) * 100))}٪`;
/** ۱٫۵ (ممیز فارسی) */
const dec = (x, d = 1) => fa(Number(x || 0).toFixed(d)).replace('.', '٫');

function toman(n) {
  if (!(n > 0)) return '—';
  const m = Math.round(n / 1e6);
  if (m >= 1000) {
    const b = Math.floor(m / 1000);
    const r = m % 1000;
    return `${fa(b)} میلیارد${r ? ` و ${fa(r)} میلیون` : ''}`;
  }
  return `${fa(m)} میلیون`;
}

// ---------------------------------------------------------------- API

class AuthError extends Error {}
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/admin/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(method !== 'GET' ? { 'X-Admin': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') throw new AuthError(data.error || 'وارد نشده‌اید.');
  if (!res.ok) throw new Error(data.error || `خطای سرور (${res.status})`);
  return data;
}

let toastTimer;
function toast(text, error = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function handleError(e) {
  if (e instanceof AuthError) return showLogin();
  toast(e.message || 'خطا', true);
}

// ---------------------------------------------------------------- ورود و بخش‌ها

const sections = ['overview', 'searches', 'train'];

function showLogin(note) {
  $('#barActions').hidden = true;
  $('#tabs').hidden = true;
  for (const s of sections) $(`#${s}`).hidden = true;
  $('#login').hidden = false;
  if (note) $('#loginNote').textContent = note;
  $('#password').focus();
}

async function boot() {
  try {
    const me = await api('me');
    if (!me.enabled) {
      showLogin('پنل مدیریت خاموش است. در لیارا، تنظیمات برنامه ← متغیرهای محیطی، متغیر ADMIN_PASSWORD را با یک رمز قوی بگذارید.');
      $('#loginForm').hidden = true;
      return;
    }
    if (!me.loggedIn) return showLogin();
    start();
  } catch (e) {
    handleError(e);
  }
}

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('#loginError');
  err.textContent = '';
  const btn = ev.submitter;
  btn.disabled = true;
  try {
    await api('login', { method: 'POST', body: { password: $('#password').value } });
    $('#password').value = '';
    start();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

function start() {
  $('#login').hidden = true;
  $('#barActions').hidden = false;
  $('#tabs').hidden = false;
  openTab(sections.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
}

function openTab(name) {
  for (const s of sections) {
    $(`#${s}`).hidden = s !== name;
    $(`#tab-${s}`).setAttribute('aria-selected', String(s === name));
  }
  history.replaceState(null, '', `#${name}`);
  ({ overview: loadOverview, searches: loadSearches, train: loadTrain })[name]();
}
$('#tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-tab]');
  if (b) openTab(b.dataset.tab);
});

// ---------------------------------------------------------------- راهنمای نمودار (نزدیک ستون، با موس یا لمس)

const tip = $('#tip');
function showTip(el, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  const y = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => (tip.hidden = true);
document.addEventListener('scroll', hideTip, { passive: true });

/** نمودار ستونی یک‌سری: points = [{ label, value, tip }] */
function columns(points, { xLabels = [], aria }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const cols = points
    .map(
      (p, i) =>
        `<span class="col${p.value ? '' : ' zero'}" tabindex="0" data-i="${i}" aria-label="${esc(p.aria)}"><i style="height:${(p.value / max) * 100}%"></i></span>`,
    )
    .join('');
  const el = document.createElement('div');
  el.className = 'chart';
  el.innerHTML = `<div class="chart-plot" role="img" aria-label="${esc(aria)}"><span class="chart-max num">${fa(max)}</span>${cols}</div>
    <div class="chart-x">${xLabels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;
  el.querySelectorAll('.col').forEach((c) => {
    const p = points[Number(c.dataset.i)];
    const show = () => showTip(c, p.tip);
    c.addEventListener('pointerenter', show);
    c.addEventListener('focus', show);
    c.addEventListener('click', show);
    c.addEventListener('pointerleave', hideTip);
    c.addEventListener('blur', hideTip);
  });
  return el;
}

// ---------------------------------------------------------------- خلاصه

let days = 30;

async function loadOverview() {
  const box = $('#overview');
  box.innerHTML = '<p class="loading">در حال خواندن…</p>';
  let s;
  try {
    s = await api(`summary?days=${days}`);
  } catch (e) {
    box.innerHTML = '';
    return handleError(e);
  }
  const store = s.storage.persistent
    ? ''
    : `<div class="notice">گزارش جستجوها فقط در حافظه است و با هر استقرار دوباره پاک می‌شود. برای نگه داشتن آن، در لیارا یک دیسک بسازید و به <code>/app/data</code> وصل کنید (راهنما در README).</div>`;
  box.innerHTML = `${store}
    <div class="card-head">
      <h1 style="font-size:20px;margin:0">خلاصهٔ جستجوها</h1>
      <div class="seg" role="group" aria-label="بازهٔ زمانی">
        ${[7, 30, 90].map((d) => `<button type="button" data-days="${d}" aria-pressed="${d === days}">${fa(d)} روز</button>`).join('')}
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><span>امروز</span><b>${fa(s.totals.today)}</b><small>جستجو</small></div>
      <div class="kpi"><span>${fa(days)} روز اخیر</span><b>${fa(s.totals.range)}</b><small>${fa(s.users)} کاربر</small></div>
      <div class="kpi"><span>قیمت پیدا شد</span><b>${pct(s.foundRate)}</b><small>از جستجوها</small></div>
      <div class="kpi"><span>جستجوی صوتی</span><b>${pct(s.voiceShare)}</b><small>${s.avgSttMs ? `میانگین تبدیل ${dec(s.avgSttMs / 1000)} ثانیه` : 'تبدیل روی سرور: —'}</small></div>
    </div>
    <div class="card" id="dailyCard"><div class="card-head"><h2>جستجو در هر روز</h2><p class="muted small">روی هر ستون بزنید</p></div></div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>پرجستجوترین خودروها</h2><p class="muted small">آخرین قیمت برآوردشده</p></div><ol class="rank" id="topCars"></ol></div>
      <div class="card"><div class="card-head"><h2>پیدا نشده‌ها</h2><p class="muted small">برای آموزش، «آموزش» را بزنید</p></div><ol class="rank" id="missed"></ol></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>برندها</h2></div><ol class="rank" id="brands"></ol></div>
      <div class="card" id="hoursCard"><div class="card-head"><h2>ساعت‌های شلوغ</h2><p class="muted small">به وقت تهران</p></div></div>
    </div>
    <div class="card" id="sttCard" ${s.sttModels.length ? '' : 'hidden'}><div class="card-head"><h2>مدل‌های تبدیل گفتار</h2><p class="muted small">کدام مدل متن را داد</p></div><ol class="rank" id="models"></ol></div>`;

  box.querySelectorAll('[data-days]').forEach((b) =>
    b.addEventListener('click', () => {
      days = Number(b.dataset.days);
      loadOverview();
    }),
  );

  // روزها
  const pts = s.perDay.map((d) => {
    const date = dateFmt.format(dayDate(d.day));
    return {
      value: d.total,
      aria: `${date}: ${fa(d.total)} جستجو`,
      tip: `<b>${esc(date)}</b><br>${fa(d.total)} جستجو · ${fa(d.found)} با قیمت<br>${fa(d.voice)} صوتی · ${fa(d.users)} کاربر`,
    };
  });
  const n = s.perDay.length;
  const xl = [s.perDay[0], s.perDay[Math.floor((n - 1) / 2)], s.perDay[n - 1]].map((d) => dayFmt.format(dayDate(d.day)));
  const daily = columns(pts, { xLabels: xl, aria: `تعداد جستجو در ${fa(days)} روز اخیر` });
  const table = document.createElement('details');
  table.innerHTML = `<summary>جدول روزها</summary><table><thead><tr><th>روز</th><th>جستجو</th><th>با قیمت</th><th>صوتی</th><th>کاربر</th></tr></thead><tbody>${s.perDay
    .slice()
    .reverse()
    .map((d) => `<tr><td>${esc(dateFmt.format(dayDate(d.day)))}</td><td class="num">${fa(d.total)}</td><td class="num">${fa(d.found)}</td><td class="num">${fa(d.voice)}</td><td class="num">${fa(d.users)}</td></tr>`)
    .join('')}</tbody></table>`;
  daily.append(table);
  $('#dailyCard').append(daily);

  // ساعت‌ها
  const hp = s.hours.map((v, h) => ({ value: v, aria: `ساعت ${fa(h)}: ${fa(v)} جستجو`, tip: `ساعت ${fa(h)} تا ${fa(h + 1)}<br>${fa(v)} جستجو` }));
  $('#hoursCard').append(columns(hp, { xLabels: ['۰', '۶', '۱۲', '۱۸', '۲۳'], aria: 'تعداد جستجو در هر ساعت روز' }));

  const rank = (el, rows, label, meta, action) => {
    const max = Math.max(1, ...rows.map((r) => r.count));
    el.innerHTML = rows.length
      ? rows
          .map(
            (r, i) => `<li><span class="name">${esc(label(r))}</span><span class="count">${fa(r.count)}</span>
            <span class="track" aria-hidden="true"><i style="width:${(r.count / max) * 100}%"></i></span>
            ${meta ? `<span class="meta">${meta(r)}${action ? ` <button class="btn btn-small" type="button" data-act="${i}">آموزش</button>` : ''}</span>` : ''}</li>`,
          )
          .join('')
      : '<li class="empty-note">هنوز چیزی نیست.</li>';
    if (action) el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => action(rows[Number(b.dataset.act)])));
  };
  rank($('#topCars'), s.topCars, (r) => r.car, (r) => (r.lastPrice ? `<bdi>${toman(r.lastPrice)} تومان</bdi>${r.lastYear ? ` · <bdi>مدل ${fa(r.lastYear)}</bdi>` : ''}` : 'بدون قیمت'));
  rank(
    $('#missed'),
    s.missed,
    (r) => r.q,
    (r) => esc(r.error ? r.error.slice(0, 70) : 'قیمتی پیدا نشد'),
    (r) => openTeach({ text: r.heard || r.q }),
  );
  rank($('#brands'), s.topBrands, (r) => r.brand);
  rank($('#models'), s.sttModels, (r) => r.model);
}

// ---------------------------------------------------------------- جستجوها

const FILTERS = [
  ['all', 'همه'],
  ['missed', 'پیدا نشده'],
  ['voice', 'صوتی'],
  ['text', 'تایپی'],
  ['learned', 'اصلاح‌شده با آموزش'],
];
const list = { filter: 'all', q: '', offset: 0, total: 0 };

function loadSearches() {
  const box = $('#searches');
  if (!box.dataset.ready) {
    box.dataset.ready = '1';
    box.innerHTML = `<div class="toolbar">
        <input type="search" id="logQ" placeholder="جستجو در گفته‌ها و خودروها…" aria-label="جستجو در گزارش">
        <div class="chips" role="group" aria-label="صافی">${FILTERS.map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === list.filter}">${t}</button>`).join('')}</div>
      </div>
      <p class="muted small" id="logCount"></p>
      <ol class="log" id="logList"></ol>
      <div class="more"><button class="btn" type="button" id="logMore" hidden>بیشتر</button></div>`;
    box.querySelectorAll('[data-f]').forEach((b) =>
      b.addEventListener('click', () => {
        list.filter = b.dataset.f;
        box.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        fetchLog(true);
      }),
    );
    let t;
    $('#logQ').addEventListener('input', (ev) => {
      clearTimeout(t);
      t = setTimeout(() => {
        list.q = ev.target.value.trim();
        fetchLog(true);
      }, 300);
    });
    $('#logMore').addEventListener('click', () => fetchLog(false));
  }
  fetchLog(true);
}

async function fetchLog(reset) {
  if (reset) list.offset = 0;
  const ul = $('#logList');
  if (reset) ul.innerHTML = '<li class="loading">در حال خواندن…</li>';
  let data;
  try {
    data = await api(`searches?${new URLSearchParams({ filter: list.filter, q: list.q, offset: list.offset, limit: 40 })}`);
  } catch (e) {
    return handleError(e);
  }
  if (reset) ul.innerHTML = '';
  list.total = data.total;
  list.offset += data.items.length;
  $('#logCount').textContent = `${fa(data.total)} جستجو`;
  if (!data.items.length && reset) ul.innerHTML = '<li class="empty-note">جستجویی با این صافی نیست.</li>';
  for (const e of data.items) ul.append(logItem(e));
  $('#logMore').hidden = list.offset >= list.total;
}

function logItem(e) {
  const li = document.createElement('li');
  const voice = e.kind === 'voice';
  const heardDiffers = e.heard && e.heard !== e.q;
  const sttVia = e.stt?.via === 'browser' ? 'تشخیص گفتار مرورگر (گوگل)' : e.stt?.model || e.stt?.via || '';
  const result = e.found
    ? `<p class="result"><bdi>${esc(e.car || e.carText || '')}</bdi>${e.year ? ` · <bdi>مدل ${fa(e.year)}</bdi>` : ''} · <bdi class="price">${toman(e.price)} تومان</bdi></p>`
    : `<p class="result miss">${esc(e.error || (e.car ? `برای ${e.car} قیمتی پیدا نشد` : 'خودرو یا قیمتی پیدا نشد'))}</p>`;
  const cands = (e.stt?.candidates || [])
    .map((c) => `<div>${esc(c.model)}: ${c.error ? `<span class="muted">خطا</span>` : `«${esc(c.text ?? '')}»`}${c.model === e.stt.model ? ' ✓' : ''}</div>`)
    .join('');
  li.innerHTML = `<div class="log-top">
      <span>${esc(timeFmt.format(new Date(e.at)))}</span>
      <span class="badge">${voice ? 'صوتی' : 'تایپی'}</span>
      <span class="badge ${e.found ? 'ok' : 'no'}">${e.found ? 'قیمت پیدا شد' : 'پیدا نشد'}</span>
      ${e.rules?.length ? '<span class="badge learn">اصلاح با آموزش</span>' : ''}
    </div>
    ${heardDiffers ? `<p class="said"><span class="lab">شنید: </span>«${esc(e.heard)}»</p><p class="small muted">جستجو شد: «${esc(e.q)}»</p>` : `<p class="said">«${esc(e.q)}»</p>`}
    ${e.rules?.length ? `<p class="small">${e.rules.map((r) => `${esc(r.from)} ← ${esc(r.to)}`).join('، ')}</p>` : ''}
    ${result}
    <details><summary>جزئیات</summary><dl>
      <dt>برداشت</dt><dd>${esc(e.carText || '—')}${e.km != null ? ` · کارکرد ${fa(nf.format(e.km))}` : ''}</dd>
      ${voice ? `<dt>تبدیل گفتار</dt><dd><bdi>${esc(sttVia || '—')}</bdi>${e.stt?.ms ? ` · <bdi>${dec(e.stt.ms / 1000)} ثانیه</bdi>` : ''}</dd>` : ''}
      ${cands ? `<dt>متن مدل‌ها</dt><dd>${cands}</dd>` : ''}
      ${e.sources ? `<dt>منبع‌ها</dt><dd>${fa(e.sources.ok)} از ${fa(e.sources.total)} نتیجه داد</dd>` : ''}
      <dt>زمان پاسخ</dt><dd>${dec((e.ms || 0) / 1000)} ثانیه</dd>
    </dl></details>
    <div class="log-actions"><button class="btn btn-small" type="button">اصلاح و آموزش</button></div>`;
  li.querySelector('.log-actions button').addEventListener('click', () => openTeach({ text: e.heard || e.q, entry: e }));
  return li;
}

// ---------------------------------------------------------------- پنجرهٔ آموزش

const teach = $('#teach');
let teachSource = '';

function openTeach({ text, entry }) {
  teachSource = text || '';
  $('#teachContext').textContent = entry
    ? `گفته: «${text}» — ${entry.found ? `پاسخ: ${entry.car || entry.carText || ''}` : 'پیدا نشد'}`
    : `گفته: «${text}»`;
  // عبارت اشتباه: بدون سال و عدد کارکرد، تا قاعده برای سال‌های دیگر هم کار کند
  $('#teachFrom').value = String(text || '')
    .replace(/(^|\s)(مدل|سال)\s+[\d۰-۹]+/g, ' ')
    .replace(/(^|\s)[\d۰-۹]{4}(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  $('#teachTo').value = '';
  $('#teachPreview').innerHTML = '';
  teach.showModal();
  $('#teachTo').focus();
}
$('#teachCancel').addEventListener('click', () => teach.close());

$('#teachTry').addEventListener('click', async () => {
  const from = $('#teachFrom').value.trim();
  const to = $('#teachTo').value.trim();
  if (!to) return $('#teachTo').focus();
  const sample = teachSource && teachSource.includes(from) ? teachSource.replace(from, to) : to;
  $('#teachPreview').innerHTML = '<span class="muted">در حال امتحان…</span>';
  try {
    const r = await api('test', { method: 'POST', body: { q: sample } });
    $('#teachPreview').innerHTML = r.car
      ? `<span class="ok">با این آموزش: «${esc(sample)}» ← <b>${esc(r.car)}</b>${r.year ? ` · مدل ${fa(r.year)}` : ''}</span>`
      : `<span class="no">با این آموزش هم خودرویی در فهرست باما پیدا نشد (برداشت: «${esc(r.carText || '—')}»). نام را کامل‌تر بنویسید، مثلاً با برند.</span>`;
  } catch (e) {
    handleError(e);
  }
});

$('#teachForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const r = await api('rules', { method: 'POST', body: { from: $('#teachFrom').value, to: $('#teachTo').value } });
    teach.close();
    toast(`یاد گرفتم: «${r.rule.from}» یعنی «${r.rule.to}»`);
    if (!$('#train').hidden) loadTrain();
  } catch (e) {
    $('#teachPreview').innerHTML = `<span class="no">${esc(e.message)}</span>`;
  }
});

// ---------------------------------------------------------------- آموزش

async function loadTrain() {
  const box = $('#train');
  if (!box.dataset.ready) {
    box.dataset.ready = '1';
    box.innerHTML = `
      <div class="card">
        <h2>هوش مصنوعی را چطور آموزش بدهم؟</h2>
        <ol class="steps">
          <li>در «جستجوها» یا «پیدا نشده‌ها»، کنار گفته‌ای که اشتباه فهمیده شد «آموزش» را بزنید و منظور درست را بنویسید.</li>
          <li>از همان لحظه، هر بار آن عبارت شنیده یا نوشته شود، به شکل درست فهمیده می‌شود؛ در صدا و در جستجوی تایپی.</li>
          <li>نام‌های درست به مدل‌های تبدیل گفتار هم داده می‌شوند تا آن نام‌ها را بهتر بشنوند.</li>
        </ol>
      </div>
      <div class="card">
        <h2>قاعدهٔ تازه</h2>
        <form class="inline-form two" id="ruleForm">
          <div><label for="ruleFrom">عبارت اشتباه</label><input id="ruleFrom" required maxlength="120" placeholder="لند کروز"></div>
          <span class="arrow" aria-hidden="true">←</span>
          <div><label for="ruleTo">منظور درست</label><input id="ruleTo" required maxlength="120" placeholder="تویوتا لندکروزر"></div>
          <button class="btn btn-primary" type="submit">افزودن</button>
        </form>
      </div>
      <div class="card"><div class="card-head"><h2>قاعده‌ها</h2><p class="muted small" id="rulesCount"></p></div><ul class="rules" id="rules"></ul></div>
      <div class="card">
        <h2>واژه‌های تازه</h2>
        <p class="muted small">نام خودرویی که مدل‌های تبدیل گفتار باید بشناسند (مثلاً مدلی تازه در بازار).</p>
        <form class="inline-form" id="wordForm" style="grid-template-columns:1fr auto;align-items:end">
          <div><label for="wordIn" class="sr">واژه</label><input id="wordIn" required maxlength="120" placeholder="مثلاً: جتور دشینگ"></div>
          <button class="btn btn-primary" type="submit">افزودن</button>
        </form>
        <div class="words" id="words"></div>
      </div>
      <div class="card">
        <h2>امتحان یک جمله</h2>
        <p class="muted small">ببینید برنامه این جمله را با آموزش‌های فعلی چطور می‌فهمد (بدون گرفتن قیمت).</p>
        <form class="inline-form" id="testForm" style="grid-template-columns:1fr auto;align-items:end">
          <div><input id="testIn" required maxlength="200" placeholder="لند کروز ۲۰۰۶ ۸ سیلندر" aria-label="جمله"></div>
          <button class="btn" type="submit">امتحان</button>
        </form>
        <div class="test-out" id="testOut" aria-live="polite"></div>
      </div>`;

    $('#ruleForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('rules', { method: 'POST', body: { from: $('#ruleFrom').value, to: $('#ruleTo').value } });
        $('#ruleFrom').value = '';
        $('#ruleTo').value = '';
        toast('قاعده اضافه شد.');
        loadTrain();
      } catch (e) {
        handleError(e);
      }
    });
    $('#wordForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('words', { method: 'POST', body: { word: $('#wordIn').value } });
        $('#wordIn').value = '';
        toast('واژه اضافه شد.');
        loadTrain();
      } catch (e) {
        handleError(e);
      }
    });
    $('#testForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const out = $('#testOut');
      out.innerHTML = '<span class="muted">در حال امتحان…</span>';
      try {
        const r = await api('test', { method: 'POST', body: { q: $('#testIn').value } });
        out.innerHTML = `<dl>
          <dt>پس از آموزش‌ها</dt><dd>«${esc(r.text)}»${r.rules.length ? ` <span class="badge learn">${fa(r.rules.length)} قاعده</span>` : ''}</dd>
          <dt>نام خودرو</dt><dd>${esc(r.carText || '—')}</dd>
          <dt>سال</dt><dd>${r.year ? fa(r.year) : '—'}</dd>
          ${r.km != null ? `<dt>کارکرد</dt><dd>${fa(nf.format(r.km))}</dd>` : ''}
          <dt>خودروی پیدا‌شده</dt><dd>${r.car ? esc(r.car) : '<span class="muted">در فهرست باما پیدا نشد (یا باما در دسترس نیست)</span>'}</dd>
        </dl>`;
      } catch (e) {
        out.innerHTML = '';
        handleError(e);
      }
    });
  }

  let data;
  try {
    data = await api('learning');
  } catch (e) {
    return handleError(e);
  }
  const ul = $('#rules');
  $('#rulesCount').textContent = `${fa(data.rules.length)} قاعده`;
  ul.innerHTML = data.rules.length ? '' : '<li class="empty-note">هنوز قاعده‌ای نیست.</li>';
  for (const r of data.rules.slice().reverse()) {
    const li = document.createElement('li');
    li.className = r.enabled ? '' : 'off';
    li.innerHTML = `<span class="map">«${esc(r.from)}»<span class="arrow">←</span>«${esc(r.to)}»</span>
      <span class="rule-ctrl">
        <label class="switch" title="روشن/خاموش"><input type="checkbox" ${r.enabled ? 'checked' : ''} aria-label="قاعدهٔ ${esc(r.from)} روشن باشد"><span></span></label>
        <button class="btn btn-small btn-danger" type="button" aria-label="حذف قاعدهٔ ${esc(r.from)}">حذف</button>
      </span>
      <span class="meta">${fa(r.hits || 0)} بار به کار رفت · ${esc(timeFmt.format(new Date(r.at)))}</span>`;
    li.querySelector('input').addEventListener('change', async (ev) => {
      try {
        await api(`rules/${encodeURIComponent(r.id)}`, { method: 'POST', body: { enabled: ev.target.checked } });
        li.className = ev.target.checked ? '' : 'off';
      } catch (e) {
        ev.target.checked = !ev.target.checked;
        handleError(e);
      }
    });
    li.querySelector('.btn-danger').addEventListener('click', async () => {
      if (!confirm(`قاعدهٔ «${r.from}» ← «${r.to}» حذف شود؟`)) return;
      try {
        await api(`rules/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
        li.remove();
        toast('حذف شد.');
      } catch (e) {
        handleError(e);
      }
    });
    ul.append(li);
  }
  const words = $('#words');
  words.innerHTML = data.words.length ? '' : '<span class="muted small">هنوز واژه‌ای نیست.</span>';
  for (const w of data.words) {
    const span = document.createElement('span');
    span.className = 'word';
    span.innerHTML = `<span>${esc(w.word)}</span><button type="button" aria-label="حذف ${esc(w.word)}">×</button>`;
    span.querySelector('button').addEventListener('click', async () => {
      try {
        await api(`words?word=${encodeURIComponent(w.word)}`, { method: 'DELETE' });
        span.remove();
      } catch (e) {
        handleError(e);
      }
    });
    words.append(span);
  }
}

boot();
