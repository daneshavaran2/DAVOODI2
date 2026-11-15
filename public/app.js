// رابط کاربری: ضبط صدا و تشخیص گفتار (روی سرور یا در مرورگر)، فراخوانی /api/price و نمایش نتیجه.

const $ = (s) => document.querySelector(s);
const micBtn = $('#micBtn');
const micLabel = $('#micLabel');
const micStatus = $('#micStatus');
const form = $('#queryForm');
const input = $('#q');
const citySel = $('#city');
const results = $('#results');

// ---------------------------------------------------------------- قالب‌بندی

const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (s) => String(s ?? '').replace(/\d/g, (d) => FA[d]);
const nf = new Intl.NumberFormat('fa-IR');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** ۱۸۱۰۰۰۰۰۰۰ ← «۱ میلیارد و ۸۱۰ میلیون تومان» */
function toman(n) {
  if (!(n > 0)) return '—';
  const m = Math.round(n / 1e6);
  if (m >= 1000) {
    const b = Math.floor(m / 1000);
    const r = m % 1000;
    return `${fa(b)}\u00a0میلیارد${r ? ` و ${fa(r)}\u00a0میلیون` : ''} تومان`;
  }
  if (m >= 1) return `${fa(m)}\u00a0میلیون تومان`;
  return `${nf.format(n)} تومان`;
}

/** برای قیمت بزرگ: عدد و واحد «تومان» جدا، تا واحد کوچک‌تر نوشته شود */
function tomanParts(n) {
  const full = toman(n);
  return full.endsWith(' تومان') ? { value: full.slice(0, -' تومان'.length), unit: 'تومان' } : { value: full, unit: '' };
}

/** کوتاه: «۱٫۸۱ میلیارد» یا «۷۴۰ میلیون» */
function short(n) {
  if (!(n > 0)) return '—';
  if (n >= 1e9) return `${fa((n / 1e9).toFixed(2).replace(/\.?0+$/, '')).replace('.', '٫')}\u00a0میلیارد`;
  return `${fa(Math.round(n / 1e6))}\u00a0میلیون`;
}

const km = (v) => (v === 0 ? 'صفر کیلومتر' : Number.isFinite(v) ? `${nf.format(v)} کیلومتر` : '');
const yearLabel = (k) => (k === 'new' ? 'صفر کیلومتر' : `مدل ${fa(k)}`);


// ---------------------------------------------------------------- تنظیمات

let config = { demo: false, cities: {}, stt: { server: false } };
const configReady = fetch('/api/config')
  .then((r) => r.json())
  .then((c) => {
    config = c;
    const banner = $('#demoBanner');
    banner.hidden = !c.demo;
    if (c.stt?.demo) banner.textContent += ' تشخیص گفتار هم نمایشی است: هر چه بگویید، یک جملهٔ نمونه برمی‌گردد.';
    for (const [id, name] of Object.entries(c.cities || {})) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = name;
      citySel.append(o);
    }
    try {
      const saved = localStorage.getItem('city');
      if (saved && [...citySel.options].some((o) => o.value === saved)) citySel.value = saved;
    } catch {}
  })
  .catch(() => {})
  .finally(setupVoice);

citySel.addEventListener('change', () => {
  try {
    localStorage.setItem('city', citySel.value);
  } catch {}
});

// ---------------------------------------------------------------- تشخیص گفتار
// حالت «server»: صدا ضبط و به /api/transcribe فرستاده می‌شود (whisper روی سرور؛ همهٔ مرورگرها).
// حالت «browser»: اگر whisper روی سرور نصب نباشد، تشخیص گفتار خود مرورگر (کروم/اج).

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceMode = null;
let rec = null; // browser mode
let recording = null; // server mode
let listening = false;
let busy = false;

function setStatus(text, isError = false) {
  micStatus.textContent = text;
  micStatus.classList.toggle('error', isError);
}

function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

function setListening(on) {
  if (on !== listening) buzz();
  listening = on;
  micBtn.classList.toggle('listening', on);
  micBtn.setAttribute('aria-pressed', String(on));
  micLabel.textContent = on ? 'می‌شنوم' : 'بگویید';
  if (!on) micBtn.style.setProperty('--level', '0');
}

function setBusy(on) {
  busy = on;
  micBtn.classList.toggle('busy', on);
  micLabel.textContent = on ? 'صبر کنید' : 'بگویید';
}

function disableMic(text, isError = false) {
  micBtn.disabled = true;
  setStatus(text, isError);
}

function setupVoice() {
  const serverStt = !!config.stt?.server;
  if (serverStt && navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext)) {
    voiceMode = 'server';
  } else if (SR) {
    voiceMode = 'browser';
  } else if (!window.isSecureContext) {
    return disableMic('برای استفاده از میکروفون، سایت باید با HTTPS باز شود. فعلاً می‌توانید تایپ کنید.', true);
  } else {
    return disableMic('این مرورگر از ضبط صدا پشتیبانی نمی‌کند. می‌توانید نام خودرو را تایپ کنید.');
  }
  if (!window.isSecureContext) {
    disableMic('برای استفاده از میکروفون، سایت باید با HTTPS باز شود. فعلاً می‌توانید تایپ کنید.', true);
  }
}

function heard(text) {
  input.value = text;
  setStatus(`شنیدم: «${text}»`);
  search(text);
}

// ---------- حالت server

function micErrorMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'اجازهٔ استفاده از میکروفون داده نشد. از تنظیمات مرورگر (آیکون قفل کنار نشانی) اجازه دهید.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'میکروفونی پیدا نشد.';
    case 'NotReadableError':
      return 'میکروفون در دست برنامهٔ دیگری است.';
    default:
      return 'شروع ضبط صدا ممکن نشد؛ دوباره امتحان کنید.';
  }
}

async function startServerVoice() {
  const { startRecording } = await import('/recorder.js');
  setListening(true);
  setStatus('بگویید… بعد از تمام شدن جمله، خودش متوجه می‌شود.');
  try {
    recording = await startRecording({
      onLevel: (l) => micBtn.style.setProperty('--level', l.toFixed(2)),
      onSpeech: () => setStatus('در حال شنیدن… (برای پایان دوباره بزنید یا مکث کنید)'),
    });
  } catch (e) {
    setListening(false);
    setStatus(micErrorMessage(e), true);
    return;
  }
  const { wav, hadSpeech } = await recording.done;
  recording = null;
  setListening(false);
  if (!hadSpeech) {
    setStatus('صدایی شنیده نشد؛ دوباره روی میکروفون بزنید و کمی بلندتر بگویید.', true);
    return;
  }
  setBusy(true);
  setStatus('در حال تبدیل گفتار به متن…');
  try {
    const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 && SR) {
      // تشخیص گفتار سرور در دسترس نیست؛ از این به بعد تشخیص گفتار مرورگر
      voiceMode = 'browser';
      throw new Error('تشخیص گفتار سرور در دسترس نیست؛ دوباره روی میکروفون بزنید (این بار مرورگر گوش می‌دهد).');
    }
    if (!res.ok) throw new Error(data.error || `خطای سرور (${res.status})`);
    if (!data.text) setStatus('متوجه نشدم؛ لطفاً دوباره و شمرده‌تر بگویید.', true);
    else heard(data.text);
  } catch (e) {
    setStatus(e.message || 'تبدیل گفتار به متن ممکن نشد.', true);
  } finally {
    setBusy(false);
  }
}

// ---------- حالت browser

const SPEECH_ERRORS = {
  'not-allowed': 'اجازهٔ استفاده از میکروفون داده نشد. از تنظیمات مرورگر اجازه دهید.',
  'service-not-allowed': 'مرورگر اجازهٔ تشخیص گفتار نداد. می‌توانید نام خودرو را تایپ کنید.',
  'no-speech': 'صدایی شنیده نشد؛ دوباره روی میکروفون بزنید.',
  'audio-capture': 'میکروفونی پیدا نشد.',
  network:
    'سرویس تشخیص گفتار مرورگر در دسترس نیست (ممکن است از داخل ایران مسدود باشد). نام خودرو را تایپ کنید.',
  'language-not-supported': 'این مرورگر تشخیص گفتار فارسی را پشتیبانی نمی‌کند. کروم را امتحان کنید یا تایپ کنید.',
};

function startBrowserVoice() {
  let finalText = '';
  let failed = false;
  rec = new SR();
  rec.lang = 'fa-IR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    setListening(true);
    setStatus('بگویید… مثلاً «پراید ۱۳۱ مدل ۹۸»');
  };
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + ' ';
      else interim += t;
    }
    input.value = (finalText + interim).trim();
  };
  rec.onerror = (e) => {
    failed = e.error !== 'aborted';
    if (failed) setStatus(SPEECH_ERRORS[e.error] || `خطای تشخیص گفتار: ${e.error}`, true);
  };
  rec.onend = () => {
    setListening(false);
    const text = finalText.trim() || input.value.trim();
    if (text && !(failed && !finalText.trim())) heard(text);
    else if (!failed) setStatus('چیزی شنیده نشد؛ دوباره امتحان کنید.', true);
  };
  try {
    rec.start();
  } catch {
    setStatus('شروع تشخیص گفتار ممکن نشد؛ دوباره امتحان کنید.', true);
  }
}

micBtn.addEventListener('click', async () => {
  if (micBtn.disabled || busy) return;
  if (listening) {
    if (recording) recording.stop();
    else if (rec) rec.stop();
    return;
  }
  if (!voiceMode) await configReady;
  if (voiceMode === 'server') startServerVoice();
  else if (voiceMode === 'browser') startBrowserVoice();
});

// ---------------------------------------------------------------- خواندن نتیجه با صدا (اگر صدای فارسی باشد)

let faVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  faVoice = speechSynthesis.getVoices().find((v) => /^fa/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

function speak(text) {
  if (!faVoice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = faVoice;
  u.lang = faVoice.lang;
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- جستجو

let controller = null;

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return input.focus();
  input.blur(); // صفحه‌کلید گوشی بسته شود تا نتیجه دیده شود
  search(q);
});

function chipSearch(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  input.value = chip.dataset.q || chip.textContent.trim();
  search(input.value);
}
$('#examples').addEventListener('click', chipSearch);

// ---------------------------------------------------------------- جستجوهای اخیر (فقط در همین مرورگر)

const recentBox = $('#recent');
const RECENT_KEY = 'recent-searches';

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.length <= 200).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecent(q) {
  const list = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
  renderRecent();
}

function renderRecent() {
  const list = loadRecent();
  recentBox.hidden = !list.length;
  recentBox.innerHTML = list.length
    ? `<span class="examples-label"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-clock"/></svg>اخیر</span>` +
      list.map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(fa(q))}</button>`).join('')
    : '';
}
recentBox.addEventListener('click', chipSearch);
renderRecent();

// ---------------------------------------------------------------- نوار پایین گوشی

const dock = $('#dock');
const phone = window.matchMedia('(max-width: 640px)');
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let micInView = true;

function updateDock() {
  const show = phone.matches && !micInView && results.childElementCount > 0;
  dock.hidden = !show;
  document.body.classList.toggle('has-dock', show);
}
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([e]) => {
    micInView = e.isIntersecting;
    updateDock();
  }).observe(micBtn);
}
phone.addEventListener?.('change', updateDock);

const toTop = () => window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
$('#dockMic').addEventListener('click', () => {
  micBtn.click(); // در همان لمس کاربر، تا مرورگر اجازهٔ میکروفون را بدهد
  toTop();
});
$('#dockType').addEventListener('click', () => {
  input.focus({ preventScroll: true });
  input.select();
  toTop();
});

async function search(q) {
  controller?.abort();
  controller = new AbortController();
  const params = new URLSearchParams({ q, city: citySel.value || 'all' });
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
  renderLoading();
  try {
    const res = await fetch(`/api/price?${params}`, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `خطای سرور (${res.status})`);
    render(data);
    if (data.summary) saveRecent(q);
    updateDock();
  } catch (err) {
    if (err.name === 'AbortError') return;
    results.setAttribute('aria-busy', 'false');
    results.innerHTML = `<div class="card error-box">${esc(err.message || 'ارتباط با سرور برقرار نشد.')}</div>`;
  }
}

function renderLoading() {
  results.setAttribute('aria-busy', 'true');
  results.innerHTML = `
    <div class="loading">
      <p>در حال گرفتن قیمت از هفت سایت؛ چند ثانیه صبر کنید…</p>
      <div class="skeleton"></div>
      <div class="skeleton short"></div>
      <div class="skeleton short"></div>
    </div>`;
  bringIntoView();
}

/** اگر بخش نتیجه پایین‌تر از صفحهٔ فعلی است، آرام به آن برو */
function bringIntoView() {
  const top = results.getBoundingClientRect().top;
  if (top < window.innerHeight * 0.6) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  results.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- نمایش نتیجه

/** «باما ۱٫۸۱ میلیارد (۵ آگهی)، دیوار …» در یک خط */
function sourceLine(group) {
  return group.sources.map((s) => `${esc(s.name)} ${short(s.median)} (${fa(s.count)} ${esc(s.basis)})`).join('، ');
}

/** درجهٔ بازهٔ قیمت: کمترین تا بیشترین، عقربه روی قیمت حدودی */
function gauge(s) {
  if (!(s.low > 0 && s.high > s.low)) return '';
  const pos = Math.min(0.98, Math.max(0.02, (s.estimate - s.low) / (s.high - s.low)));
  const ticks = Array.from({ length: 21 }, (_, i) => {
    const x = i * 5;
    const major = i % 5 === 0;
    return `<line x1="${x}" x2="${x}" y1="${major ? 18 : 27}" y2="39" stroke="currentColor" stroke-width="${major ? 1.5 : 1}" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  return `
    <figure class="gauge" role="img" aria-label="بازهٔ قیمت از ${esc(short(s.low))} تا ${esc(short(s.high))} تومان">
      <div class="gauge-scale" style="--pos:${pos.toFixed(3)}">
        <svg class="gauge-ticks" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${ticks}<line x1="0" x2="100" y1="39.5" y2="39.5" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
        <span class="gauge-fill"></span>
        <span class="gauge-run"><span class="gauge-needle"></span></span>
      </div>
      <figcaption class="gauge-ends" aria-hidden="true">
        <span>کمترین<b>${short(s.low)}</b></span>
        <span>بیشترین<b>${short(s.high)}</b></span>
      </figcaption>
    </figure>`;
}

function carName(data) {
  return (
    data.canonical?.title ||
    data.sources.find((s) => s.id === 'bama' && s.matched)?.matched.title ||
    data.sources.find((s) => s.matched)?.matched.title ||
    data.query.carText
  );
}

function carMeta(data) {
  const q = data.query;
  const asked = [q.year ? `مدل ${fa(q.year.value)}` : '', q.condition === 'new' ? 'صفر کیلومتر' : q.condition === 'used' ? 'کارکرده' : '']
    .filter(Boolean)
    .join('، ');
  return asked || (data.summary?.label ? fa(data.summary.label) : '');
}

function shareText(data) {
  const s = data.summary;
  const meta = carMeta(data);
  const range = s.low && s.high && s.low !== s.high ? `\nبازه: ${short(s.low)} تا ${short(s.high)} تومان` : '';
  return `قیمت حدودی امروز ${fa(carName(data))}${meta ? `، ${meta}` : ''}: ${toman(s.estimate)}${range}\n(از ${fa(s.sources.length)} سایت قیمت خودرو)`;
}

async function share(btn, text) {
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'قیمت‌یاب خودرو', text, url });
    } catch {}
    return;
  }
  const label = btn.querySelector('span');
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    label.textContent = 'کپی شد؛ در پیام‌رسان بچسبانید';
  } catch {
    label.textContent = 'کپی ممکن نشد';
  }
  setTimeout(() => (label.textContent = 'ارسال قیمت'), 2500);
}

function verdictHead(data) {
  const q = data.query;
  const name = carName(data);
  const meta = carMeta(data);
  const unclear = q.yearUnclear
    ? '<p class="note">سال ساخت را متوجه نشدم؛ قیمت سال‌های مختلف پایین‌تر آمده است. می‌توانید دوباره بگویید یا سال را بنویسید.</p>'
    : '';
  return `
    <header class="verdict-head">
      <h2 class="car">${esc(fa(name))}</h2>
      ${meta ? `<p class="car-meta">${esc(meta)}</p>` : ''}
      ${unclear}
    </header>`;
}

function verdictCard(data) {
  const s = data.summary;
  const { value } = tomanParts(s.estimate);
  const rows = s.sources
    .map(
      (src) =>
        `<div><dt>${esc(src.name)}</dt><dd class="v">${short(src.median)}</dd><dd class="c">${fa(src.count)}\u00a0${esc(src.basis)}</dd></div>`,
    )
    .join('');
  const speakBtn = faVoice
    ? `<button type="button" class="speak" data-say="${esc(`قیمت حدودی ${toman(s.estimate)}`)}"><svg aria-hidden="true"><use href="#i-speak"/></svg><span>بلند بخوان</span></button>`
    : '';
  const actions = `<div class="verdict-actions"><button type="button" class="speak share"><svg aria-hidden="true"><use href="#i-share"/></svg><span>ارسال قیمت</span></button>${speakBtn}</div>`;
  return `
    <article class="verdict">
      ${verdictHead(data)}
      <p class="verdict-label">قیمت حدودی امروز، به تومان</p>
      <p class="verdict-price">${value}</p>
      <p class="verdict-exact">${nf.format(s.estimate)} تومان</p>
      ${gauge(s)}
      <section class="by-source" aria-label="قیمت در هر منبع">
        <h3>قیمت در هر منبع</h3>
        <dl>${rows}</dl>
      </section>
      ${actions}
    </article>`;
}

function newCarCard(data) {
  const n = data.newCar;
  if (!n || data.summary?.key === 'new') return '';
  return `
    <div class="card">
      <div class="mini"><h2>صفر کیلومتر</h2><span class="val">${toman(n.estimate)}</span></div>
      <p class="mini-src">${sourceLine(n)}</p>
    </div>`;
}

function factoryCard(data) {
  if (!data.factory?.length) return '';
  const rows = data.factory
    .slice(0, 8)
    .map((f) => `<tr><td>${esc(fa(f.trim || '—'))}</td><td>${fa(f.year || '')}</td><td class="num">${toman(f.price)}</td></tr>`)
    .join('');
  return `
    <div class="card">
      <h2>قیمت کارخانه</h2>
      <p class="sub">قیمت مصوب برای ثبت‌نام و قرعه‌کشی؛ معمولاً کمتر از قیمت بازار است و در برآورد بالا حساب نشده.</p>
      <table><thead><tr><th>تیپ</th><th>سال</th><th>قیمت</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

function yearsCard(data) {
  if (!data.byYear?.length) return '';
  const target = data.summary?.key;
  const rows = data.byYear
    .map(
      (y) => `
      <tr class="${y.key === target ? 'is-target' : ''}">
        <td>${fa(y.key)}</td>
        <td class="num">${short(y.estimate)}</td>
        <td class="muted">${y.sources.map((s) => esc(s.name)).join('، ')}، ${fa(y.count)} قیمت</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="card">
      <h2>کارکرده، به تفکیک سال ساخت</h2>
      ${data.byYear.some((y) => y.key === target) ? '<p class="sub">سطر رنگی، سالی است که پرسیدید.</p>' : ''}
      <table class="years"><thead><tr><th>مدل</th><th>قیمت حدودی (تومان)</th><th>منبع</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

function itemRow(it) {
  const name = [it.title, it.kind === 'list' ? it.trim : it.title.includes(it.trim) ? '' : it.trim].filter(Boolean).join(' ');
  const meta = [
    it.year ? `مدل ${fa(it.year)}` : '',
    it.kind === 'list' ? (it.provider || (it.isNew ? 'قیمت صفر' : 'قیمت بازار')) : km(it.mileage),
    it.city,
    it.time,
  ]
    .filter(Boolean)
    .map(esc)
    .join('، ');
  const title = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(fa(name))}</a>`
    : `<span class="t">${esc(fa(name))}</span>`;
  const price = it.price ? short(it.price) : esc(it.note || '—');
  return `<li><div class="what">${title}<div class="meta">${fa(meta)}</div></div><div class="price">${price}</div></li>`;
}

function sourceCard(s) {
  const priced = (s.items || []).filter((i) => i.price > 0).length;
  const state = !s.ok ? 'bad' : priced ? '' : 'warn';
  const meta = !s.ok
    ? 'در دسترس نبود'
    : s.matched
      ? `${esc(fa(s.matched.title))}، ${fa(priced)} قیمت`
      : 'پیدا نشد';
  const notes = [
    ...(!s.ok ? [`<p class="note bad">${esc(s.error)}</p>`] : []),
    ...(s.warnings || []).map((w) => `<p class="note">${esc(fa(w))}</p>`),
  ].join('');
  const lists = (s.items || []).filter((i) => i.kind === 'list');
  const ads = (s.items || []).filter((i) => i.kind !== 'list');
  const section = (title, arr) => (arr.length ? `<h3>${title}</h3><ul class="rows">${arr.map(itemRow).join('')}</ul>` : '');
  const link = s.link
    ? `<p><a class="ext" href="${esc(s.link)}" target="_blank" rel="noopener">مشاهده در ${esc(s.name)}<svg aria-hidden="true"><use href="#i-out"/></svg></a></p>`
    : '';
  const adsTitle = s.totalAds > ads.length ? `آگهی‌ها (${fa(ads.length)} از ${fa(s.totalAds)})` : 'آگهی‌ها';
  return `
    <details class="source">
      <summary><span class="dot ${state}"></span><span class="src-name">${esc(s.name)}</span><span class="src-meta">${meta}</span><svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg></summary>
      <div class="source-body">
        ${notes}
        ${section('فهرست قیمت', lists)}
        ${section(adsTitle, ads)}
        ${!lists.length && !ads.length && s.ok ? '<p class="muted">قیمتی برای این جستجو پیدا نشد.</p>' : ''}
        ${link}
      </div>
    </details>`;
}

const priced = (s) => (s.items || []).some((i) => i.price > 0);

function sourcesCard(list) {
  const sorted = [...list].sort((a, b) => priced(b) - priced(a));
  const n = list.filter(priced).length;
  return `
    <section class="card sources" aria-labelledby="srcTitle">
      <h2 id="srcTitle">جزئیات هر سایت</h2>
      <p class="sub">${fa(n)} سایت از ${fa(list.length)} سایت برای این جستجو قیمت داشت. برای دیدن قیمت‌ها و آگهی‌ها، نام سایت را بزنید.</p>
      ${sorted.map(sourceCard).join('')}
    </section>`;
}

function render(data) {
  results.setAttribute('aria-busy', 'false');
  if (data.error) {
    results.innerHTML = `<div class="card empty">${esc(data.error)}</div>`;
    return;
  }
  const q = data.query;
  const yearTxt = q.year ? `، مدل ${fa(q.year.value)}` : '';
  const allFailed = data.sources.every((s) => !s.ok);
  let main;
  if (data.summary) {
    main = verdictCard(data) + newCarCard(data);
  } else {
    const msg = allFailed
      ? 'هیچ‌کدام از سایت‌ها در دسترس نبود. اگر سرور خارج از ایران است، این سایت‌ها درخواستش را رد می‌کنند. جزئیات خطا پایین صفحه است.'
      : `برای «${esc(fa(q.carText))}»${esc(yearTxt)} قیمتی پیدا نشد. نام را کامل‌تر بگویید (مثلاً با تیپ) یا سال دیگری را امتحان کنید.`;
    // دیوار همیشه با خود متن پرسش جستجو می‌کند؛ «شناخته شدن» یعنی باما یا همراه مکانیک خودرو را پیدا کرده باشند
    const known = data.canonical?.title || data.sources.some((s) => s.id !== 'divar' && s.matched);
    const head = known
      ? verdictHead(data)
      : `<header class="verdict-head"><h2 class="car">${allFailed ? 'سایت‌ها در دسترس نبودند' : 'این خودرو را پیدا نکردم'}</h2></header>`;
    main = `<article class="verdict verdict-empty">${head}<p class="msg${allFailed ? ' error-box' : ''}">${msg}</p></article>`;
  }

  results.innerHTML = main + hintsCard(data) + yearsCard(data) + factoryCard(data) + sourcesCard(data.sources);
  results.querySelector('.speak:not(.share)')?.addEventListener('click', (e) => speak(e.currentTarget.dataset.say));
  results.querySelector('.share')?.addEventListener('click', (e) => share(e.currentTarget, shareText(data)));
  results.querySelectorAll('.hint-chip').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.dataset.q;
      search(b.dataset.q);
    }),
  );
}

/** «کدام مدل؟»، «کدام تیپ؟»، «منظورتان این بود؟» — با زدن هر دکمه، همان جستجو دقیق‌تر تکرار می‌شود. */
function hintsCard(data) {
  if (!data.hints?.length) return '';
  const q = data.query;
  const suffix = [q.year ? `مدل ${q.year.value}` : '', q.condition === 'new' ? 'صفر' : q.condition === 'used' ? 'کارکرده' : '']
    .filter(Boolean)
    .join(' ');
  const block = (h) => `
    <div class="hint">
      <p>${esc(fa(h.text))}</p>
      <div class="examples">${h.options
        .map((o) => `<button type="button" class="chip hint-chip" data-q="${esc(`${o} ${suffix}`.trim())}">${esc(fa(o))}</button>`)
        .join('')}</div>
    </div>`;
  return `<div class="card hints">${data.hints.map(block).join('')}</div>`;
}

// ---------------------------------------------------------------- اجرای اولیه

const initial = new URLSearchParams(location.search).get('q');
if (initial) {
  input.value = initial;
  search(initial);
}
