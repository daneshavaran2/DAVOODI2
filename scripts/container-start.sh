#!/bin/sh
# شروع برنامه در کانتینر Docker.
# پوشهٔ مدل‌ها (که ممکن است دیسک لیارا باشد و مال root) برای کاربر node قابل نوشتن می‌شود،
# سپس برنامه با کاربر node (نه root) اجرا می‌شود.
set -e

MODELS_DIR="${WHISPER_MODELS_DIR:-/app/whisper/models}"
mkdir -p "$MODELS_DIR"

if [ "$(id -u)" = "0" ]; then
  chown node:node "$MODELS_DIR" 2>/dev/null || echo "هشدار: مالکیت $MODELS_DIR تغییر نکرد؛ شاید دانلود مدل ممکن نباشد."
  exec setpriv --reuid=node --regid=node --init-groups node server.js
fi

exec node server.js
