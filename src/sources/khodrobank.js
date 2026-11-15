// خودروبانک (khodrobank.com): قیمت روز خودرو. نشانی صفحهٔ قیمت از پیوند «قیمت خودرو» در صفحهٔ اول
// سایت پیدا می‌شود؛ اگر لازم شد، با متغیر محیطی KHODROBANK_URLS داده می‌شود.

import { createPriceListSource } from './pricelist.js';

export const SITE = 'https://www.khodrobank.com';
const src = createPriceListSource({
  id: 'khodrobank',
  name: 'خودروبانک',
  site: SITE,
  pages: [],
  envVar: 'KHODROBANK_URLS',
});

export const { info, lookup, _reset } = src;
