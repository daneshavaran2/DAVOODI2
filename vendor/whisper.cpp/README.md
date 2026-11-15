# whisper.cpp ساخته‌شده برای لینوکس x64

این پوشه `whisper-cli` و کتابخانه‌های آن را دارد تا ساخت تصویر Docker روی لیارا فقط کپی فایل باشد
(کامپایل whisper.cpp حدود ۳٫۵ دقیقه طول می‌کشد و از سقف ۵ دقیقه‌ای ساخت در لیارا بیشتر می‌شود).

## منشأ

- **کد منبع:** [whisper.cpp](https://github.com/ggml-org/whisper.cpp) نسخهٔ `v1.9.5` (commit `d1be6fde`)، بدون تغییر. مجوز: MIT (`linux-x64/LICENSE`).
- **کامپایلر:** gcc 14.2.0 در Debian 13 (trixie). gcc 12 (Debian bookworm) نسخهٔ AMX را نادرست می‌ساخت و روی پردازندهٔ دارای AMX با «Illegal instruction» از کار می‌افتاد.
- **تنظیمات ساخت:**

  ```
  cmake -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
        -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DBUILD_SHARED_LIBS=ON \
        -DCMAKE_INSTALL_RPATH='$ORIGIN' -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
  cmake --build build --target whisper-cli
  strip --strip-unneeded whisper-cli *.so*
  ```

- **چند نسخه برای پردازنده‌های مختلف:** همهٔ نسخه‌های CPU (از SSE4.2 تا AVX-512 و AMX) ساخته شده‌اند و `whisper-cli` هنگام اجرا بهترین را برای پردازندهٔ سرور بار می‌کند. کتابخانه‌ها کنار خود برنامه پیدا می‌شوند (`RUNPATH=$ORIGIN`).
- **نیاز:** glibc ۲٫۳۸ یا بالاتر (Debian trixie، Ubuntu 24.04).
- **کنترل سلامت:** checksum هر فایل در `SHA256SUMS` است و آزمون `test/vendor.test.js` آن را بررسی می‌کند.

## بازسازی

با Docker (حدود ۴ دقیقه):

```bash
bash scripts/build-whisper-linux.sh
```

این اسکریپت همان دستورهای بالا را در `debian:trixie-slim` اجرا می‌کند و `SHA256SUMS` را به‌روز می‌کند.
