# قیمت‌یاب خودرو: تصویر Docker برای لیارا (یا هر سرور دیگر)
#
# ساخت فقط کپی فایل است (چند ثانیه)، تا از سقف ۵ دقیقه‌ای ساخت در لیارا رد نشود:
#   - whisper-cli از پیش ساخته شده و در vendor/whisper.cpp است (منشأ، تنظیمات و checksumها همان‌جا؛
#     بازسازی: bash scripts/build-whisper-linux.sh)
#   - مدل Whisper (حدود ۸۷۰ مگابایت) هنگام اولین اجرا در پس‌زمینه دانلود می‌شود (src/model.js)؛
#     تا آن موقع سایت کار می‌کند و تشخیص گفتار مرورگر استفاده می‌شود.
#
# اگر Docker Hub محدودیت داد:  --build-arg BASE_REGISTRY=mirror.gcr.io/library/

ARG BASE_REGISTRY=
FROM ${BASE_REGISTRY}node:22-trixie-slim

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TRUST_PROXY=1
WORKDIR /app

# whisper-cli و نسخه‌های CPU آن (به glibc ۲٫۳۸+ نیاز دارد؛ trixie دارد)
COPY vendor/whisper.cpp/linux-x64 /app/whisper/whisper.cpp/build/bin
COPY package.json server.js ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
# بازار نمونه فقط برای حالت نمایشی (DEMO=1)
COPY test/fixtures/market.json ./test/fixtures/market.json

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# پوشهٔ مدل را برای کاربر node قابل نوشتن می‌کند (دیسک لیارا معمولاً مال root است) و برنامه را با کاربر node اجرا می‌کند
CMD ["sh", "scripts/container-start.sh"]
