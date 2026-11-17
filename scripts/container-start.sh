#!/bin/sh
# شروع برنامه در کانتینر Docker. هیچ مرحله‌ای نباید جلوی بالا آمدن برنامه را بگیرد:
# سکوهایی مثل لیارا ممکن است کانتینر را با کاربر غیر root، یا با root ولی بدون اجازهٔ تغییر کاربر،
# اجرا کنند. در آن صورت این مراحل بی‌صدا رد می‌شوند و برنامه با کاربر فعلی اجرا می‌شود.

MODELS_DIR="${WHISPER_MODELS_DIR:-/app/whisper/models}"
mkdir -p "$MODELS_DIR" 2>/dev/null
# پوشهٔ داده‌های پنل مدیریت (گزارش جستجوها و آموزش)؛ اگر دیسک لیارا این‌جا وصل است، مال root است
DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR" 2>/dev/null

if [ "$(id -u)" = "0" ]; then
  # پوشهٔ مدل (شاید دیسک لیارا که مال root است) برای کاربر node قابل نوشتن شود، سپس اجرا با کاربر node
  chown node:node "$MODELS_DIR" 2>/dev/null
  chown -R node:node "$DATA_DIR" 2>/dev/null
  # کاربر node با اجازهٔ گوش دادن روی پورت‌های زیر ۱۰۲۴ (برای EXTRA_PORTS مثل 80)
  CAPS="--inh-caps=+net_bind_service --ambient-caps=+net_bind_service"
  if setpriv --reuid=node --regid=node --init-groups $CAPS true 2>/dev/null; then
    exec setpriv --reuid=node --regid=node --init-groups $CAPS node server.js
  fi
  if setpriv --reuid=node --regid=node --init-groups true 2>/dev/null; then
    exec setpriv --reuid=node --regid=node --init-groups node server.js
  fi
  echo "اجرا با کاربر node ممکن نشد؛ برنامه با کاربر فعلی اجرا می‌شود."
fi

exec node server.js
