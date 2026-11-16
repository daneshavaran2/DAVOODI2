#!/usr/bin/env python3
"""فهرست برندها، مدل‌ها و رنگ‌ها را از «بانک اطلاعاتی داوودی» (xlsx) می‌خواند و src/data/car-catalog.js را می‌سازد.

فقط این شیت‌ها خوانده می‌شوند: «برندهای اصلاح‌شده»، «مدل‌های یکتا»، «رنگ‌ها». شیت خودروها (شماره شاسی، قیمت،
کارکرد) خوانده نمی‌شود و در مخزن نمی‌آید.

اجرا (نیاز به openpyxl):
    python3 scripts/import-catalog.py path/to/davoodi_comprehensive_database.xlsx
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ZWNJ = '‌'

# اصلاح‌های «خطاهای برند»، «خطاهای مدل اولیه» و «نگاشت پیشنهادی» همان فایل
BRAND_FIX = {'سنتینیال': 'هیوندای', 'دیگنیتی': 'بهمن', 'فردا موتور (FMC)': 'فردا موتور'}
MODEL_FIX = {
    ('سنتینیال', 'vs460'): 'سنتنیال VS460',
    ('دیگنیتی', 'prime'): 'دیگنیتی پرایم',
    ('تویوتا', 'BZD3'): 'bZ3',
    ('تویوتا', 'BX3X'): 'bZ3X',
    ('تویوتا', 'GX_R'): 'لندکروزر GX-R',
    ('تویوتا', 'لندکروز GX_R'): 'لندکروزر GX-R',
    ('تویوتا', 'پرادو آنرود'): 'پرادو آفرود',
    ('تویوتا', '300'): 'لندکروزر 300',
    ('چری', 'فونیکس fx'): None,  # همان «فونیکس FX»
    ('فونیکس', 'تیگو هشت پرومکس +E'): 'تیگو 8 پرومکس +E',
    ('چانگان', 'UNI_T'): 'UNI-T',
    ('چانگان', 'UNi_Z'): 'UNI-Z',
    ('هونگچی', 'EQM 5'): 'E-QM5',
    ('پارس خودرو', 'برلیانس'): None,  # خانواده، نه مدل
    ('آئودی', 'ای-ترون Q5'): 'Q5 e-tron',
}
BRAND_DROP = {'آ'}


def clean(s):
    return re.sub(r'\s+', ' ', str(s or '').replace(ZWNJ, ' ')).strip()


def main(path, out):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

    def rows(name):
        return list(wb[name].iter_rows(values_only=True))[1:]

    brands = []
    for r in rows('برندهای اصلاح‌شده'):
        b = BRAND_FIX.get(clean(r[0]), clean(r[0]))
        if b and b not in BRAND_DROP and b not in brands:
            brands.append(b)

    models = []
    seen = set()
    for r in rows('مدل‌های یکتا'):
        b0, m0 = clean(r[0]), clean(r[1])
        if not b0 or not m0 or b0 in BRAND_DROP:
            continue
        m = MODEL_FIX.get((b0, m0), m0)
        if m is None:
            continue
        b = BRAND_FIX.get(b0, b0)
        key = (b, m.lower().replace(' ', ''))
        if key in seen:
            continue
        seen.add(key)
        models.append([b, m])
        if b not in brands:
            brands.append(b)

    colors = []
    for r in rows('رنگ‌ها'):
        c = clean(r[1])
        if c and c not in colors:
            colors.append(c)

    js = (
        '// ساخته‌شده از «بانک اطلاعاتی داوودی» (فقط برندها، مدل‌ها و رنگ‌ها) با scripts/import-catalog.py؛ دستی ویرایش نکنید.\n'
        '// برای به‌روزرسانی: python3 scripts/import-catalog.py <فایل xlsx>\n\n'
        f'export const BRANDS = {json.dumps(brands, ensure_ascii=False)};\n\n'
        'export const MODELS = [\n'
        + ''.join(f'  {json.dumps(m, ensure_ascii=False)},\n' for m in models)
        + '];\n\n'
        f'export const COLORS = {json.dumps(colors, ensure_ascii=False)};\n'
    )
    Path(out).write_text(js, encoding='utf-8')
    print(f'{len(brands)} برند، {len(models)} مدل، {len(colors)} رنگ ← {out}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent.parent / 'src/data/car-catalog.js'))
