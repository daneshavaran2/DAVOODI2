// کار (car.ir): جدول عمومی قیمت روز خودرو، با قیمت بازار و کارخانه.

import { createPriceListSource } from './pricelist.js';

export const SITE = 'https://car.ir';
const src = createPriceListSource({
  id: 'carir',
  name: 'کار.آی‌آر',
  site: SITE,
  pages: [`${SITE}/prices`, `${SITE}/prices2`],
  envVar: 'CARIR_URLS',
});

export const { info, lookup, rows, _reset } = src;
