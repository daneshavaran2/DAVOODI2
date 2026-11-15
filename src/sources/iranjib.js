// ایران‌جیب (iranjib.ir): جدول «قیمت خودرو تولید داخل» و «قیمت خودرو وارداتی»، با قیمت بازار و نمایندگی.

import { createPriceListSource } from './pricelist.js';

export const SITE = 'https://www.iranjib.ir';
const src = createPriceListSource({
  id: 'iranjib',
  name: 'ایران‌جیب',
  site: SITE,
  pages: [
    `${SITE}/showgroup/45/${encodeURIComponent('قیمت-خودرو-تولید-داخل')}/`,
    `${SITE}/showgroup/46/${encodeURIComponent('قیمت-خودرو-وارداتی')}/`,
  ],
  envVar: 'IRANJIB_URLS',
});

export const { info, lookup, _reset } = src;
