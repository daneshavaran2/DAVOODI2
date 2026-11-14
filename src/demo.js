// حالت نمایشی و آزمون: به جای اینترنت، از «بازار نمونه» (test/fixtures/market.json) پاسخ‌هایی
// با همان ساختار پاسخ واقعی باما، دیوار و همراه مکانیک می‌سازد. قیمت‌ها واقعی نیستند.
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

/** نام کامل خودروها و برآوردهای درست بازار نمونه، برای آزمون‌ها. */
export function demoMarket() {
  return market;
}

/** fetch جعلی که درخواست‌های سه سایت را از بازار نمونه جواب می‌دهد. */
export function createDemoFetch({ delay = 0, fail = [] } = {}) {
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
    return respond({}, 404);
  };
}
