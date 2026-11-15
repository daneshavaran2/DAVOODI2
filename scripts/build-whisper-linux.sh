#!/usr/bin/env bash
# بازسازی vendor/whisper.cpp/linux-x64 از کد منبع رسمی whisper.cpp با Docker.
#   bash scripts/build-whisper-linux.sh
# (برای نسخهٔ دیگر: WHISPER_CPP_VERSION=v1.x.y bash scripts/build-whisper-linux.sh)

set -euo pipefail

VERSION="${WHISPER_CPP_VERSION:-v1.9.5}"
IMAGE="${BUILD_IMAGE:-debian:trixie-slim}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/vendor/whisper.cpp/linux-x64"

command -v docker >/dev/null || { echo "Docker لازم است." >&2; exit 1; }
rm -rf "$OUT"
mkdir -p "$OUT"

docker run --rm -v "$OUT:/out" "$IMAGE" bash -euc "
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends git cmake g++ make ca-certificates > /dev/null
  git clone -q --depth 1 --branch '$VERSION' https://github.com/ggml-org/whisper.cpp.git /src
  cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF \
    -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DBUILD_SHARED_LIBS=ON \
    '-DCMAKE_INSTALL_RPATH=\$ORIGIN' -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON > /dev/null
  cmake --build /src/build -j\$(nproc) --config Release --target whisper-cli whisper-server > /dev/null
  cp -a /src/build/bin/. /out/
  cp /src/LICENSE /out/LICENSE
  find /out -type f \( -name '*.so*' -o -name whisper-cli -o -name whisper-server \) -exec strip --strip-unneeded {} +
  gcc --version | head -1
  chown -R $(id -u):$(id -g) /out
"

(cd "$OUT" && find . -type f ! -name LICENSE | sort | xargs sha256sum) > "$OUT/../SHA256SUMS"
echo "ساخته شد: $OUT"
echo "checksumها: $OUT/../SHA256SUMS"
