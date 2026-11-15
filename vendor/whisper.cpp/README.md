# whisper.cpp ساخته‌شده برای لینوکس x64

این پوشه `whisper-cli`، `whisper-server` (همان مدل، همیشه در حافظه؛ هر جمله بدون بار کردن دوبارهٔ مدل) و کتابخانه‌های آن‌ها را دارد تا ساخت تصویر Docker روی لیارا فقط کپی فایل باشد
(کامپایل whisper.cpp حدود ۳٫۵ دقیقه طول می‌کشد و از سقف ۵ دقیقه‌ای ساخت در لیارا بیشتر می‌شود).

## منشأ

- **کد منبع:** [whisper.cpp](https://github.com/ggml-org/whisper.cpp) نسخهٔ `v1.9.5` (commit `d1be6fde`)، بدون تغییر. مجوز: MIT (`linux-x64/LICENSE`).
- **کامپایلر:** gcc 14.2.0 در Debian 13 (trixie). gcc 12 (Debian bookworm) نسخهٔ AMX را نادرست می‌ساخت و روی پردازندهٔ دارای AMX با «Illegal instruction» از کار می‌افتاد.
- **تنظیمات ساخت:**

  ```
  cmake -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
        -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DBUILD_SHARED_LIBS=ON \
        -DCMAKE_INSTALL_RPATH='$ORIGIN' -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
  cmake --build build --target whisper-cli whisper-server
  strip --strip-unneeded whisper-cli whisper-server *.so*
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

## whisper-server در این پوشه

`whisper-server` با همان کد منبع (`examples/server`، v1.9.5، بدون تغییر) و همان کامپایلر (gcc 14.2.0 در Debian trixie)
ساخته و به همین کتابخانه‌ها پیوند داده شده است:

```
g++ -O2 -std=c++17 -DNDEBUG -I include -I ggml/include -I examples \
    examples/server/server.cpp examples/common.cpp examples/common-whisper.cpp examples/grammar-parser.cpp \
    -L linux-x64 -l:libwhisper.so.1 -l:libggml.so.0 -l:libggml-base.so.0 -lpthread -Wl,-rpath,'$ORIGIN'
```

در آزمایش با ۲ هسته و مدل turbo q8_0، هر جملهٔ کوتاه با whisper-server حدود ۳ ثانیه و با whisper-cli حدود ۴ تا ۵ ثانیه طول کشید.
