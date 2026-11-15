// حالت نمایشی و آزمون: به جای اینترنت، از «بازار نمونه» (test/fixtures/market.json) پاسخ‌هایی
// با همان ساختار پاسخ واقعی باما، دیوار و همراه مکانیک می‌سازد (و با extra: true، ایران‌جیب، car.ir،
// خودروبانک و خودرو۴۵). قیمت‌ها واقعی نیستند.
// جستجوی دیوار مثل نسخهٔ واقعی «متنی» است: هر آگهی که کلمه‌ای مشترک با پرسش داشته باشد برمی‌گردد
// (خودروهای دیگر و آگهی‌های بی‌ربط هم)، تا صافی‌های برنامه واقعاً آزموده شوند.

import { readFileSync } from 'node:fs';
import { toEnDigits, toFaDigits } from './text.js';
import { tokens } from './match.js';

const market = JSON.parse(readFileSync(new URL('../test/fixtures/market.json', import.meta.url), 'utf8'));
const BUILD_ID = 'demoBuild123';
const sep = (n) => n.toLocaleString('en-US');

function respond(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const trimOf = (car, p) => (p.trim ? car.trims[p.trim] : null);
const titleOf = (car, p) => trimOf(car, p)?.title || car.title;
const valueOf = (car, p) => (p.trim ? `${car.value},${p.trim}` : car.value);

// ---------------------------------------------------------------- باما

function bamaVehicles() {
  const data = Object.entries(market.brands).map(([brand, b]) => ({
    type: 'brand', title: b.bama, selectable: false, value: brand, text: b.bama, id: 0,
    items: [
      { type: 'brand', title: b.bama, selectable: true, select_all: true, value: brand, text: `همه مدل های ${b.bama}`, keywords: ` ${b.bama} ${brand}`, id: 0 },
      ...market.cars
        .filter((c) => c.value.split(',')[0] === brand)
        .map((c) => ({
          type: 'model', title: c.title, selectable: false, value: c.value, text: c.title, id: 0,
          items: [
            { type: 'model', title: c.title, selectable: true, select_all: true, value: c.value, text: `همه نوع ${c.title}`, keywords: ` ${c.keywords}`, id: 0 },
            ...Object.entries(c.trims).map(([k, t]) => ({
              type: 'trim', title: t.title, selectable: true, select_all: false, value: `${c.value},${k}`, text: t.title, keywords: ` ${c.keywords} ${t.fa}`, id: 0,
            })),
          ],
        })),
    ],
  }));
  return { status: true, errors: [], metadata: null, data };
}

function bamaAds() {
  const ads = [];
  let n = 0;
  for (const car of market.cars) {
    for (const p of car.prices) {
      for (const [i, price] of (p.bama || []).entries()) {
        n++;
        const value = valueOf(car, p);
        const km = p.new ? 0 : 60000 + i * 17000;
        ads.push({
          value,
          year: p.year,
          km,
          ad: {
            type: 'ad',
            detail: {
              type: 'car', code: `b${n}`, url: `/car/detail-b${n}-${value.replace(/,/g, '-')}-${p.year}`,
              title: car.title.replace(' ', '، '), trim: trimOf(car, p)?.fa || '', year: String(p.year),
              mileage: km === 0 ? 'صفر کیلومتر' : `${sep(km)} km`, location: ['تهران / پونک', 'کرج', 'اصفهان', 'مشهد'][i % 4],
              time: `${i + 1} ساعت پیش`, transmission: 'دنده ای', fuel: 'بنزینی',
            },
            price: { type: 'lumpsum', price: sep(price), prepayment: '0', payment: '0' },
          },
        });
      }
    }
  }
  // آگهی‌هایی که نباید در برآورد بیایند
  const extra = (code, year, km, price, title, type) => ({
    value: 'peugeot,206ir,type2', year, km,
    ad: {
      type: 'ad',
      detail: { type: 'car', code, url: `/car/detail-${code}`, title, trim: 'تیپ 2', year: String(year), mileage: km ? `${sep(km)} km` : 'صفر کیلومتر', location: 'تهران', time: '۱ ساعت پیش' },
      price: { type, price: sep(price), prepayment: type === 'installment' ? sep(price / 2) : '0', payment: '0' },
    },
  });
  ads.push(extra('inst1', 1400, 90000, 1850000000, 'پژو، 206', 'installment'));
  ads.push(extra('hav1', 1404, 0, 2200000000, 'حواله پژو، 206', 'lumpsum'));
  return ads;
}

function bama(url) {
  const p = url.searchParams;
  if (url.pathname === '/cad/api/filter/vehicle') return respond(bamaVehicles());
  if (url.pathname === '/cad/api/search') {
    const vehicle = p.get('vehicle') || '';
    const page = Number(p.get('pageIndex') || 0);
    const all = bamaAds().filter(
      (a) =>
        (!vehicle || a.value === vehicle || a.value.startsWith(`${vehicle},`)) &&
        (!p.get('yearFrom') || a.year >= Number(p.get('yearFrom'))) &&
        (!p.get('yearTo') || a.year <= Number(p.get('yearTo'))) &&
        (p.get('mileageTo') === null || a.km <= Number(p.get('mileageTo'))),
    );
    const slice = all.slice(page * 30, page * 30 + 30).map((a) => a.ad);
    return respond({
      metadata: { total_count: all.length, has_next: all.length > (page + 1) * 30 },
      status: true, errors: [], data: { ads: slice },
    });
  }
  if (url.pathname === '/cad/api/price/detail') {
    const car = market.cars.find((c) => c.value === `${p.get('brand')},${p.get('model')}`);
    if (!car) return respond({ status: false, errors: ['not found'] }, 404);
    const items = [];
    for (const pr of car.prices) {
      if (p.get('trim') && pr.trim !== p.get('trim')) continue;
      const detail = (price, provider) => ({
        detail: { trim: pr.trim || '', trim_fa: trimOf(car, pr)?.fa || '', model_year: pr.year, class: '', price, price_diff: 0.5, price_date: '۳ ساعت پیش', price_provider: provider },
        history: [],
      });
      if (pr.market) items.push(detail(pr.market, 'قیمت بازار'));
      if (pr.factory) items.push(detail(pr.factory, 'قیمت کارخانه'));
    }
    const [brandFa, ...modelFa] = car.title.split(' ');
    return respond({ status: true, errors: [], metadata: null, data: { brand: p.get('brand'), brand_fa: brandFa, model_fa: modelFa.join(' '), items } });
  }
  return respond({}, 404);
}

// ---------------------------------------------------------------- دیوار

function divarRows() {
  const rows = [];
  let n = 0;
  for (const car of market.cars) {
    for (const p of car.prices) {
      for (const [i, price] of (p.divar || []).entries()) {
        n++;
        rows.push({
          title: toFaDigits(`${titleOf(car, p)}، مدل ${p.year}`),
          price,
          km: p.new ? 0 : 70000 + i * 23000,
          token: `d${n}`,
        });
      }
    }
  }
  rows.push({ title: toFaDigits('پژو 206 تیپ 2، مدل 1400'), price: 'توافقی', km: 80000, token: 'dNeg' });
  for (const [i, x] of market.divarNoise.entries()) rows.push({ ...x, km: 0, token: `dX${i}` });
  return rows;
}

function divarWidget(r) {
  return {
    widget_type: 'POST_ROW',
    data: {
      '@type': 'type.googleapis.com/widgets.PostRowData', title: r.title, token: r.token,
      action: { type: 'VIEW_POST', payload: { token: r.token, web_info: { title: r.title, city_persian: 'تهران', district_persian: 'پونک' } } },
      top_description_text: r.km === 0 ? 'کارکرد صفر' : `${toFaDigits(sep(r.km))} کیلومتر`,
      middle_description_text: typeof r.price === 'number' ? `${toFaDigits(sep(r.price))} تومان` : r.price,
      bottom_description_text: 'دقایقی پیش در پونک',
    },
  };
}

function divar(url, init) {
  if (url.pathname !== '/v8/postlist/w/search') return respond({}, 404);
  const req = JSON.parse(init?.body || '{}');
  const qTok = tokens(toEnDigits(req.search_data?.query || '')).filter((t) => t.length >= 2 || /\d/.test(t));
  const hits = divarRows().filter((r) => {
    const tTok = tokens(r.title);
    return qTok.some((q) => tTok.some((t) => t === q || (q.length >= 3 && t.startsWith(q))));
  });
  return respond({
    list_top_widgets: [],
    list_widgets: hits.map(divarWidget),
    pagination: { has_next_page: false, data: { '@type': 'type.googleapis.com/post_list.PaginationData', page: 2 } },
  });
}

// ---------------------------------------------------------------- همراه مکانیک

function hamrahRow(car, p) {
  return {
    brandEnglishName: car.hamrah.brand, modelName: car.hamrah.name, nickName: car.hamrah.name,
    modelEnglishName: car.hamrah.model, carTypeName: trimOf(car, p)?.fa || 'استاندارد',
    carYear: p.year, marketPrice: p.hamrah, existPriceZero: !!p.new,
  };
}

function hamrahPage(page) {
  if (page === 'carprice/dakheli') {
    const byBrand = {};
    for (const car of market.cars.filter((c) => c.hamrah.domestic)) {
      for (const p of car.prices.filter((x) => x.new && x.hamrah)) {
        (byBrand[car.hamrah.brand] ||= []).push(hamrahRow(car, p));
      }
    }
    return { pricesList: Object.entries(byBrand).map(([b, rows]) => ({ brandEnglishName: b, carPriceDetailsDtos: rows })) };
  }
  if (page === 'carprice/khareji') return { pricesList: [] };
  if (page === 'cars-for-sale') {
    return { brands: market.hamrahBrands.map((b, i) => ({ brandId: i + 1, brandName: b.name, brandEnglishName: b.slug })) };
  }
  const parts = page.split('/');
  if (parts[0] !== 'carprice') return null;
  if (parts.length === 2) {
    const cars = market.cars.filter((c) => c.hamrah.brand === parts[1]);
    if (!cars.length) return null;
    return {
      modelsCardList: cars.map((c) => ({
        carName: c.hamrah.name, modelEnglishName: c.hamrah.model, mainBrandEnglishName: c.hamrah.brand,
        minPrice: Math.min(...c.prices.map((p) => p.hamrah)), maxPrice: Math.max(...c.prices.map((p) => p.hamrah)),
      })),
    };
  }
  if (parts.length === 3) {
    const car = market.cars.find((c) => c.hamrah.brand === parts[1] && c.hamrah.model === parts[2]);
    if (!car) return null;
    return {
      modelDetail: { nickName: car.hamrah.name },
      yearsPriceList: { lastUpdateTime: '2026-11-13T23:00:00+03:30', carPriceOtherYearsDetails: car.prices.filter((p) => p.hamrah).map((p) => hamrahRow(car, p)) },
    };
  }
  return null;
}

function hamrah(url) {
  if (url.pathname === '/') {
    return new Response(`<html><script id="__NEXT_DATA__" type="application/json">{"buildId":"${BUILD_ID}"}</script></html>`, { status: 200 });
  }
  const m = url.pathname.match(/^\/_next\/data\/([^/]+)\/(.+)\.json$/);
  if (!m || m[1] !== BUILD_ID) return respond({}, 404);
  const pp = hamrahPage(m[2]);
  return pp ? respond({ pageProps: pp }) : respond({}, 404);
}

// ---------------------------------------------------------------- منبع‌های دیگر (extra)

const html = (body, title = '') =>
  new Response(`<!doctype html><html lang="fa"><head><title>${title}</title></head><body>${body}</body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

/** خودروهای صفر بازار نمونه، هر تیپ یک سطر: { maker, name, market, factory } */
function newCarRows() {
  const out = [];
  for (const car of market.cars) {
    const maker = car.hamrah.brand === 'saipa' ? 'سایپا' : car.hamrah.brand === 'kia' ? 'کیا' : 'ایران خودرو';
    for (const p of car.prices.filter((x) => x.new && x.market)) out.push({ maker, name: titleOf(car, p), market: p.market, factory: p.factory || null });
  }
  return out;
}

// ایران‌جیب: جدول قدیمی با سطر خودروساز (catsection) و سرستون؛ قیمت‌ها به تومان
function iranjib(url) {
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith('/showgroup/46/')) return html('<table class="items_table"><tr><th>نام خودرو</th><th>قیمت بازار</th><th>قیمت نمایندگی</th></tr></table>');
  if (!path.startsWith('/showgroup/45/')) return html('<p>صفحه پیدا نشد</p>', 'ایران‌جیب');
  let rows = '';
  let maker = '';
  for (const r of newCarRows()) {
    if (r.maker !== maker) {
      maker = r.maker;
      rows += `<tr class="catsection"><td colspan="3">${maker}</td></tr>`;
    }
    rows += `<tr><td class="name"><a href="#">${toFaDigits(r.name)}</a></td><td>${sep(r.market + 20e6)}</td><td>${r.factory ? sep(r.factory) : '-'}</td></tr>`;
  }
  return html(
    `<h1>قیمت خودرو تولید داخل (تومان)</h1><table class="items_table"><tr><th>نام خودرو</th><th>قیمت بازار (تومان)</th><th>قیمت نمایندگی (تومان)</th></tr>${rows}</table>`,
    'قیمت خودرو تولید داخل - ایران جیب',
  );
}

// car.ir: جدول به «میلیون تومان» با رقم فارسی و سال در نام
function carir(url) {
  if (url.pathname === '/prices2') return html('<p>به‌زودی</p>');
  if (url.pathname !== '/prices') return html('<p>خانه</p>', 'کار');
  const rows = newCarRows()
    .map(
      (r) =>
        `<tr><td>${toFaDigits(`${r.name} مدل 1405`)}</td><td>${toFaDigits(sep(Math.round((r.market - 10e6) / 1e6)))}</td><td>${r.factory ? toFaDigits(sep(Math.round(r.factory / 1e6))) : 'ـ'}</td><td>+۰٫۵٪</td></tr>`,
    )
    .join('');
  return html(
    `<div class="prices"><table><thead><tr><th>خودرو</th><th>قیمت بازار (میلیون تومان)</th><th>قیمت کارخانه (میلیون تومان)</th><th>تغییر</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    'قیمت روز خودرو | کار',
  );
}

// خودروبانک: صفحهٔ اول پیوند «قیمت روز خودرو» دارد؛ صفحهٔ قیمت داده را در __NEXT_DATA__ می‌گذارد
function khodrobank(url) {
  if (url.pathname === '/') {
    return html('<nav><a href="/news">اخبار</a> <a href="/car-price/">قیمت روز خودرو</a></nav><p>اخبار خودرو</p>', 'خودروبانک');
  }
  if (url.pathname !== '/car-price/') return html('<p>پیدا نشد</p>');
  const byMaker = {};
  for (const r of newCarRows()) (byMaker[r.maker] ||= []).push({ name: r.name, marketPrice: r.market - 30e6, factoryPrice: r.factory, unit: 'toman' });
  const data = { props: { pageProps: { priceList: Object.entries(byMaker).map(([brandName, cars]) => ({ brandName, cars })) } }, page: '/car-price' };
  return html(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`, 'قیمت روز خودرو - خودروبانک');
}

// خودرو۴۵: آگهی‌های کارشناسی‌شده (JSON، تومان)
function khodro45Results() {
  const out = [];
  let n = 0;
  for (const car of market.cars) {
    const [brandFa, ...modelFa] = car.title.split(' ');
    for (const p of car.prices) {
      const base = p.new ? p.market : (p.bama || [])[0] || p.hamrah;
      if (!base) continue;
      n++;
      out.push({
        slug: `K${n}`.padEnd(6, 'X'),
        price: base,
        final_price: base + 15e6,
        price_type: 2,
        car_properties: {
          brand: { title: brandFa, title_en: car.value.split(',')[0], seo_slug: car.value.split(',')[0] },
          model: { title: modelFa.join(' '), title_en: car.value.split(',')[1], seo_slug: car.value.split(',')[1] },
          trim: trimOf(car, p)?.fa || '',
          option: '',
          year: String(p.year),
        },
        city: { title: 'تهران', title_en: 'Tehran' },
        car_specifications: { klm: p.new ? 0 : 85000 + n * 1000 },
      });
    }
  }
  return out;
}

function khodro45(url) {
  if (url.pathname !== '/api/v2/car_listing/') return html('<p>خودرو۴۵</p>');
  const qTok = tokens(toEnDigits(url.searchParams.get('search') || ''));
  const hits = khodro45Results().filter((r) => {
    const tTok = tokens(`${r.car_properties.brand.title} ${r.car_properties.model.title}`);
    return qTok.length && qTok.every((q) => tTok.includes(q));
  });
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 12);
  return respond({ count: hits.length, next: null, previous: null, results: hits.slice(offset, offset + limit) });
}

// منبع دیگر (baravard.com): پیوند تیپ‌ها در صفحهٔ pricing، و صفحهٔ هر تیپ با بازهٔ قیمت در ld+json
function baravardTrims() {
  const out = [];
  let id = 300;
  for (const car of market.cars) {
    const keys = [...new Set(car.prices.map((p) => p.trim || ''))];
    for (const k of keys) {
      id++;
      const name = k ? car.trims[k].title : car.title;
      out.push({ id: String(id), name, slug: encodeURIComponent(name.replace(/ /g, '-')), car, trim: k });
    }
  }
  return out;
}

function baravard(url) {
  const trims = baravardTrims();
  if (url.pathname === '/' || url.pathname === '/pricing') {
    const links = url.pathname === '/pricing' ? trims.map((t) => `<li><a href="/pricing/${t.id}/${t.slug}">${toFaDigits(t.name)}</a></li>`).join('') : '';
    return html(`<nav><a href="/pricing">قیمت خودرو</a></nav><ul>${links}</ul>`, 'برآورد');
  }
  const m = url.pathname.match(/^\/pricing\/(\d+)\//);
  const t = m && trims.find((x) => x.id === m[1]);
  if (!t) return html('<p>پیدا نشد</p>');
  const year = Number(url.searchParams.get('model'));
  const p = t.car.prices.find((x) => (x.trim || '') === t.trim && x.year === year && !x.new);
  const base = p && (p.hamrah || (p.bama || [])[0]);
  if (!base) return html(`<h1>${t.name}</h1><p>برای این سال قیمتی ثبت نشده است.</p>`);
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: t.name, offers: { '@type': 'AggregateOffer', lowPrice: base - 40e6, highPrice: base + 40e6, priceCurrency: 'IRT' } };
  return html(
    `<script type="application/ld+json">${JSON.stringify(ld)}</script><h1>قیمت ${toFaDigits(t.name)} مدل ${toFaDigits(year)}</h1><p>قیمت تخمینی: ${toFaDigits(sep(base - 40e6))} تا ${toFaDigits(sep(base + 40e6))} تومان</p>`,
  );
}

/** نام کامل خودروها و برآوردهای درست بازار نمونه، برای آزمون‌ها. */
export function demoMarket() {
  return market;
}

/**
 * fetch جعلی که درخواست‌های سایت‌ها را از بازار نمونه جواب می‌دهد.
 * extra: ایران‌جیب، car.ir، خودروبانک، خودرو۴۵ و منبع دیگر هم (بدون آن، فقط سه سایت اصلی و بقیه ۴۰۴).
 */
export function createDemoFetch({ delay = 0, fail = [], extra = false } = {}) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail.includes(url.host)) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNRESET' };
      throw err;
    }
    if (url.host === 'bama.ir') return bama(url);
    if (url.host === 'api.divar.ir') return divar(url, init);
    if (url.host === 'www.hamrah-mechanic.com') return hamrah(url);
    if (extra) {
      if (url.host === 'www.iranjib.ir') return iranjib(url);
      if (url.host === 'car.ir') return carir(url);
      if (url.host === 'www.khodrobank.com') return khodrobank(url);
      if (url.host === 'khodro45.com') return khodro45(url);
      if (url.host === 'baravard.com') return baravard(url);
    }
    return respond({}, 404);
  };
}
