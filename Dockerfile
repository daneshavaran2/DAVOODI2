# قیمت‌یاب خودرو: تصویر Docker برای لیارا (یا هر سرور دیگر)
#
# ساخت کوتاه است تا از سقف ۵ دقیقه‌ای ساخت در لیارا رد نشود:
#   - whisper-cli از پیش ساخته شده و در vendor/whisper.cpp است (منشأ، تنظیمات و checksumها همان‌جا؛
#     بازسازی: bash scripts/build-whisper-linux.sh)
#   - مدل Whisper turbo q8_0 (۸۷۴ مگابایت؛ دست‌کم ۱٫۴ گیگابایت حافظه) هنگام ساخت روی سرور آلمانِ لیارا
#     دانلود و داخل تصویر گذاشته می‌شود؛ بدون دیسک و بدون دسترسی سرور ایران به huggingface هم تشخیص گفتار
#     روی سرور کار می‌کند (برای آیفون لازم است؛ سافاری فارسی را خودش تشخیص نمی‌دهد). با ۲ هسته هر جمله
#     حدود ۳ ثانیه (whisper-server، مدل همیشه در حافظه).
#     پلن ۱ گیگابایتی: --build-arg WHISPER_BUNDLE=large-v3-turbo-q5_0 (کندتر). بدون مدل: WHISPER_BUNDLE=none.
#     اگر دانلود ممکن نشد، ساخت ادامه می‌یابد.
#
# اگر Docker Hub محدودیت داد:  --build-arg BASE_REGISTRY=mirror.gcr.io/library/

ARG BASE_REGISTRY=
FROM ${BASE_REGISTRY}node:22-trixie-slim

# WHISPER_REQUIRE_DISK: مدل فقط وقتی خودکار دانلود می‌شود که دیسکی به /app/whisper/models وصل باشد
# EXTRA_PORTS: علاوه بر PORT روی این پورت‌ها هم گوش می‌دهد، تا اگر سکو پورت دیگری (مثلاً پیش‌فرض 80)
# در نظر گرفت، باز هم کار کند؛ در لاگ («اتصال رسید: پورت …») هم معلوم می‌شود کدام پورت استفاده شده است
ENV NODE_ENV=production \
    PORT=3000 \
    EXTRA_PORTS=80,8080,8000,5000 \
    TRUST_PROXY=1 \
    WHISPER_REQUIRE_DISK=1
WORKDIR /app

# مدل داخل تصویر، پیش از کپی کد تا با هر تغییر کد دوباره دانلود نشود
ARG WHISPER_BUNDLE=large-v3-turbo-q8_0
COPY scripts/bundle-model.mjs /tmp/bundle-model.mjs
RUN node /tmp/bundle-model.mjs "$WHISPER_BUNDLE" /app/whisper/bundled; rm -f /tmp/bundle-model.mjs

# whisper-cli و نسخه‌های CPU آن (به glibc ۲٫۳۸+ نیاز دارد؛ trixie دارد)
COPY vendor/whisper.cpp/linux-x64 /app/whisper/whisper.cpp/build/bin
COPY package.json server.js ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
# بازار نمونه فقط برای حالت نمایشی (DEMO=1)
COPY test/fixtures/market.json ./test/fixtures/market.json
# پوشهٔ مدل از پیش ساخته و برای هر کاربری قابل نوشتن است؛ چون سکو ممکن است کانتینر را با کاربر
# غیر root (حتی با UID دلخواه) اجرا کند و آن وقت ساختن این پوشه هنگام اجرا ممکن نیست
RUN mkdir -p /app/whisper/models && chmod 0777 /app/whisper/models

EXPOSE 3000 80 8080 8000 5000
# پوشهٔ مدل را برای کاربر node قابل نوشتن می‌کند (دیسک لیارا معمولاً مال root است) و برنامه را با کاربر node اجرا می‌کند
CMD ["sh", "scripts/container-start.sh"]
