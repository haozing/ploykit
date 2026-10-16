# Build the embedded QuickJS-ng WebAssembly engine.
#
# See README.md for provenance, patches and the full rebuild/verification
# procedure. Output: ../wasm/quickjs.wasm (embedded via //go:embed).
#
# Usage:
#   WASI_SDK_PATH=/path/to/wasi-sdk make
#
# On Windows without a Unix toolchain this runs inside WSL:
#   MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu make -C /mnt/d/.../csrc WASI_SDK_PATH=$HOME/wasi-sdk

WASI_SDK_PATH ?= $(HOME)/wasi-sdk
CC := $(WASI_SDK_PATH)/bin/clang

# Physical C shadow stack, in bytes. Keep in sync with
# platform/renderx/engine.go:WasmShadowStackSize — the Go side validates
# PoolOptions.MaxStackSize against it (MaxLogicalStackSize = this − 1MiB).
STACK_SIZE := 8388608

# Static memory reserve: BSS (8MiB arena + 512KiB JSValue slots + ~64KiB
# globals) + STACK_SIZE + heap headroom, page-aligned. Must stay above
# __stack_pointer's init value or the module fails to link.
INITIAL_MEMORY := 25165824

# 128MiB ceiling for the linear memory (heap grows on demand up to this).
MAX_MEMORY := 134217728

CFLAGS := \
	-Os \
	-flto \
	-D_GNU_SOURCE \
	-DCONFIG_VERSION=\"0.17.0\" \
	-DNDEBUG \
	-Iquickjs-ng \
	-I. \
	-fvisibility=hidden

LDFLAGS := \
	-Wl,--no-entry \
	-Wl,--export-dynamic \
	-Wl,--allow-undefined \
	-Wl,--initial-memory=$(INITIAL_MEMORY) \
	-Wl,--max-memory=$(MAX_MEMORY) \
	-Wl,--lto-O3 \
	-Wl,--gc-sections \
	-Wl,--strip-debug \
	-nostartfiles \
	-Wl,-z,stack-size=$(STACK_SIZE)

SRCS := \
	quickjs-ng/quickjs.c \
	quickjs-ng/dtoa.c \
	quickjs-ng/libunicode.c \
	quickjs-ng/libregexp.c \
	bridge.c

all: ../wasm/quickjs.wasm

../wasm/quickjs.wasm: $(SRCS)
	$(CC) $(CFLAGS) $(LDFLAGS) $(SRCS) -o $@
	@echo ""
	@sha256sum $@
	@ls -la $@

clean:
	rm -f ../wasm/quickjs.wasm

.PHONY: all clean
