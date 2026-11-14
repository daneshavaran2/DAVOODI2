# قیمت‌یاب خودرو: تصویر Docker برای لیارا (یا هر سرور دیگر)
#   مرحلهٔ ۱: ساخت whisper-cli از whisper.cpp (همهٔ گونه‌های CPU، انتخاب خودکار هنگام اجرا)
#   مرحلهٔ ۲: دانلود مدل Whisper (پیش‌فرض: large-v3-turbo-q8_0، حدود ۸۷۰ مگابایت)
#   مرحلهٔ ۳: برنامهٔ Node.js (بدون وابستگی npm)
#
# ساخت بدون تشخیص گفتار روی سرور:  docker build --build-arg WHISPER_MODEL_NAME=none .

# اگر Docker Hub محدودیت داد، می‌توان آینه داد؛ مثلاً --build-arg BASE_REGISTRY=mirror.gcr.io/library/
ARG BASE_REGISTRY=
ARG NODE_IMAGE=${BASE_REGISTRY}node:22-trixie-slim
ARG DEBIAN_IMAGE=${BASE_REGISTRY}debian:trixie-slim

# ---------------------------------------------------------------- ۱. whisper-cli
FROM ${DEBIAN_IMAGE} AS whisper
ARG WHISPER_CPP_VERSION=v1.9.5
# پردازندهٔ سروری که برنامه رویش اجرا می‌شود معلوم نیست (و با سرور ساخت فرق دارد). پس همهٔ گونه‌های
# CPU ساخته می‌شوند و whisper-cli هنگام اجرا بهترین را برای همان پردازنده بار می‌کند
# (در آزمایش: ۲٫۶ برابر سریع‌تر از ساخت فقط با AVX2). gcc 14 لازم است: نسخهٔ AMX ساخت gcc 12
# (دبیان bookworm) روی همان پردازنده با «Illegal instruction» از کار می‌افتاد.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git cmake g++ make ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_CPP_VERSION" https://github.com/ggml-org/whisper.cpp.git /src \
 && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF \
      -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DBUILD_SHARED_LIBS=ON \
 && cmake --build /src/build -j"$(nproc)" --config Release --target whisper-cli \
 && mkdir /out && cp -a /src/build/bin/. /out/ \
 && find /out -type f \( -name '*.so*' -o -name whisper-cli \) -exec strip --strip-unneeded {} +

# ---------------------------------------------------------------- ۲. مدل
FROM ${DEBIAN_IMAGE} AS model
ARG WHISPER_MODEL_NAME=large-v3-turbo-q8_0
ARG WHISPER_MODEL_URL=
# کنترل سلامت فایل مدل پیش‌فرض؛ برای مدل دیگر خالی بگذارید یا مقدار درست را بدهید
ARG WHISPER_MODEL_SHA256=317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /models \
 && if [ "$WHISPER_MODEL_NAME" != "none" ]; then \
      file="/models/ggml-$WHISPER_MODEL_NAME.bin"; \
      url="${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WHISPER_MODEL_NAME.bin}"; \
      curl -fL --retry 3 -o "$file" "$url"; \
      if [ "$WHISPER_MODEL_NAME" = "large-v3-turbo-q8_0" ] && [ -n "$WHISPER_MODEL_SHA256" ]; then \
        echo "$WHISPER_MODEL_SHA256  $file" | sha256sum -c -; \
      fi; \
    fi

# ---------------------------------------------------------------- ۳. برنامه
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TRUST_PROXY=1 \
    LD_LIBRARY_PATH=/app/whisper/whisper.cpp/build/bin
WORKDIR /app
COPY --from=whisper /out /app/whisper/whisper.cpp/build/bin
COPY --from=model /models /app/whisper/models
COPY package.json server.js ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
# بازار نمونه فقط برای حالت نمایشی (DEMO=1)
COPY test/fixtures/market.json ./test/fixtures/market.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
