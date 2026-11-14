#!/usr/bin/env bash
# نصب تشخیص گفتار روی سرور: ساخت whisper.cpp و دانلود مدل Whisper.
#
#   bash scripts/setup-whisper.sh              # مدل پیش‌فرض: small-q8_0 (حدود ۲۶۰ مگابایت)
#   bash scripts/setup-whisper.sh medium-q5_0  # دقیق‌تر برای فارسی، کندتر (حدود ۵۴۰ مگابایت)
#
# پیش‌نیاز (اوبونتو/دبیان):  sudo apt install -y build-essential cmake git curl
#
# اگر huggingface.co از سرور در دسترس نیست، فایل مدل را جای دیگری دانلود کنید و در
# whisper/models/ggml-<نام مدل>.bin بگذارید، یا نشانی دیگری با WHISPER_MODEL_URL بدهید.

set -euo pipefail

MODEL="${1:-${WHISPER_MODEL_NAME:-small-q8_0}}"
VERSION="${WHISPER_CPP_VERSION:-v1.9.5}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/whisper"
SRC="$ROOT/whisper.cpp"
BIN="$SRC/build/bin/whisper-cli"
FILE="$ROOT/models/ggml-$MODEL.bin"

case "$MODEL" in
  tiny|tiny-q5_1|tiny-q8_0|base|base-q5_1|base-q8_0|small|small-q5_1|small-q8_0|\
  medium|medium-q5_0|medium-q8_0|large-v3-turbo|large-v3-turbo-q5_0|large-v3-turbo-q8_0) ;;
  *) echo "نام مدل ناشناخته: $MODEL" >&2; exit 1 ;;
esac

mkdir -p "$ROOT/models"

# ---------------------------------------------------------------- ساخت whisper-cli
if [ -x "$BIN" ]; then
  echo "whisper-cli از قبل ساخته شده است: $BIN"
else
  for tool in git cmake g++ make; do
    command -v "$tool" >/dev/null || { echo "ابزار $tool نصب نیست. اجرا کنید: sudo apt install -y build-essential cmake git curl" >&2; exit 1; }
  done
  if [ ! -d "$SRC" ]; then
    echo "دریافت whisper.cpp $VERSION ..."
    git clone --depth 1 --branch "$VERSION" https://github.com/ggml-org/whisper.cpp.git "$SRC"
  fi
  echo "ساخت whisper-cli (چند دقیقه طول می‌کشد) ..."
  cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF
  cmake --build "$SRC/build" -j"$(nproc 2>/dev/null || echo 2)" --config Release --target whisper-cli
fi

# ---------------------------------------------------------------- دانلود مدل
if [ -s "$FILE" ]; then
  echo "مدل از قبل موجود است: $FILE"
else
  URL="${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin}"
  echo "دانلود مدل $MODEL از $URL ..."
  curl -L --fail --retry 3 --progress-bar -o "$FILE.part" "$URL"
  mv "$FILE.part" "$FILE"
fi

echo
echo "تمام شد. سرور را دوباره اجرا کنید (npm start)؛ در خروجی باید «تشخیص گفتار روی سرور: فعال» ببینید."
echo "مدل: $FILE"
