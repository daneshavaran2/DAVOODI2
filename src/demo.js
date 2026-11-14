// حالت نمایشی و تست: به جای اینترنت، از داده‌های نمونهٔ test/fixtures پاسخ می‌دهد
// (ساختار همان پاسخ واقعی سایت‌هاست ولی قیمت‌ها واقعی نیستند).

import { readFileSync } from 'node:fs';
import { toEnDigits } from './text.js';

const dir = new URL('../test/fixtures/', import.meta.url);
const load = (f) => readFileSync(new URL(f, dir), 'utf8');
const json = (f) => JSON.parse(load(f));

function respond(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function bama(url) {
  const p = url.searchParams;
  if (url.pathname === '/cad/api/filter/vehicle') return respond(json('bama-vehicles.json'));
  if (url.pathname === '/cad/api/search') {
    const body = json('bama-search.json');
    const vehicle = p.get('vehicle') || '';
    const page = Number(p.get('pageIndex') || 0);
    body.data.ads = body.data.ads.filter((a) => {
      const d = a.detail;
      const year = Number(d.year);
      const km = /صفر/.test(d.mileage) ? 0 : Number(toEnDigits(d.mileage).replace(/\D/g, ''));
      return (
        page === 0 &&
        vehicle.startsWith('peugeot,206ir') &&
        (!vehicle.split(',')[2] || d.url.includes(`-${vehicle.split(',')[2]}-`)) &&
        (!p.get('yearFrom') || year >= Number(p.get('yearFrom'))) &&
        (!p.get('yearTo') || year <= Number(p.get('yearTo'))) &&
        (p.get('mileageTo') === null || km <= Number(p.get('mileageTo')))
      );
    });
    return respond(body);
  }
  if (url.pathname === '/cad/api/price/detail') {
    if (p.get('brand') !== 'peugeot' || p.get('model') !== '206ir') return respond({ status: false, errors: ['not found'] }, 404);
    const body = json('bama-price.json');
    if (p.get('trim')) body.data.items = body.data.items.filter((i) => i.detail.trim === p.get('trim'));
    return respond(body);
  }
  return respond({}, 404);
}

async function divar(url, init) {
  if (url.pathname !== '/v8/postlist/w/search') return respond({}, 404);
  const req = JSON.parse(init?.body || '{}');
  const q = toEnDigits(req.search_data?.query || '');
  const body = json('divar-search.json');
  if (!q.includes('206')) body.list_widgets = [];
  return respond(body);
}

function hamrah(url) {
  if (url.pathname === '/') return new Response(load('hamrah-home.html'), { status: 200 });
  const m = url.pathname.match(/^\/_next\/data\/([^/]+)\/(.+)\.json$/);
  if (!m || m[1] !== 'demoBuild123') return respond({}, 404);
  const files = {
    'carprice/dakheli': 'hamrah-dakheli.json',
    'carprice/khareji': 'hamrah-khareji.json',
    'cars-for-sale': 'hamrah-cfs.json',
    'carprice/saipa': 'hamrah-saipa.json',
    'carprice/irankhodro/peugeot206': 'hamrah-model-206.json',
    'carprice/saipa/pride131': 'hamrah-model-pride131.json',
  };
  return files[m[2]] ? respond(json(files[m[2]])) : respond({}, 404);
}

/** fetch جعلی که درخواست‌های سه سایت را با داده‌های نمونه جواب می‌دهد. */
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
