#!/usr/bin/env bash
# make-free rebuild (for WSL images without make): same flags as the Makefile.
# Usage: WASI_SDK_PATH=$HOME/wasi-sdk ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

WASI_SDK_PATH="${WASI_SDK_PATH:-$HOME/wasi-sdk}"
CC="$WASI_SDK_PATH/bin/clang"
[ -x "$CC" ] || { echo "clang not found at $CC (set WASI_SDK_PATH)"; exit 1; }

STACK_SIZE=8388608
INITIAL_MEMORY=25165824
MAX_MEMORY=134217728

"$CC" \
  -Os -flto -D_GNU_SOURCE -D'CONFIG_VERSION="0.17.0"' -DNDEBUG -Iquickjs-ng -I. -fvisibility=hidden \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--allow-undefined \
  -Wl,--initial-memory=$INITIAL_MEMORY -Wl,--max-memory=$MAX_MEMORY \
  -Wl,--lto-O3 -Wl,--gc-sections -Wl,--strip-debug -nostartfiles \
  -Wl,-z,stack-size=$STACK_SIZE \
  quickjs-ng/quickjs.c quickjs-ng/dtoa.c quickjs-ng/libunicode.c quickjs-ng/libregexp.c bridge.c \
  -o ../wasm/quickjs.wasm

sha256sum ../wasm/quickjs.wasm
ls -la ../wasm/quickjs.wasm
