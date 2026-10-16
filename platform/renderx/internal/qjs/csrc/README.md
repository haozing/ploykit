# csrc — sources for the embedded QuickJS-ng wasm engine

`../wasm/quickjs.wasm` is **built from this directory** (embedded via
`//go:embed`; consumed by `internal/bridge` through wazero). Earlier releases
shipped a wasm binary copied from upstream with no in-repo build recipe; that
is why two field-reported engine defects (FP walks #15/#16) could only be
mitigated, not cured. This directory is the cure's precondition: anyone can
reproduce the exact binary, and the quickjs-ng version is a pinned, reviewable
choice rather than whatever the binding repo last compiled.

## Provenance

| Component | Source | License |
|---|---|---|
| `bridge.c` | [Gaurav-Gosain/quickjs](https://github.com/Gaurav-Gosain/quickjs) @ `65b9e11` (the wazero glue the Go binding was vendored from) | MIT |
| `quickjs-ng/` | [quickjs-ng/quickjs](https://github.com/quickjs-ng/quickjs) tag **v0.17.0** (`6d46d07`), unmodified subset (files needed to compile: `quickjs.c`, `dtoa.c`, `libunicode.c`, `libregexp.c` + headers) | MIT |
| Toolchain | [wasi-sdk 29.0](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-29) (`clang 21.1.4-wasi-sdk`, x86_64-linux or -windows) | Apache-2.0 w/ LLVM exceptions |

Engine pedigree (why quickjs-ng): it is the actively maintained fork of
Bellard's QuickJS; AWS LLRT (the Lambda JS runtime) uses it via rquickjs, and
the wazero binding here is only thin glue — the engine quality lives in
quickjs-ng. v0.17.0 specifically contains upstream PR
[#1700](https://github.com/quickjs-ng/quickjs/pull/1700) "Add WASI configurable
stack overflow protection", which removed the `__wasi__` guard-disable that
turned deep recursion into an uncatchable wasm trap. See ADR 0015.

## ploykit modifications (bridge.c)

1. `ARENA_SIZE` 4MiB → 8MiB — the Go side writes each SSR bundle through this
   arena; large products' minified bundles (3.5–4MB) sat within 1MB of the old
   ceiling, where a mid-render arena reset could strand an in-flight string.
2. `arena_alloc()` returns `NULL` for a single allocation larger than the
   arena instead of wrapping to offset 0 and overrunning adjacent static data
   (silent corruption); the failure surfaces as a clean `WASM allocation
   failed` error in the Go bridge.

`quickjs-ng/` is **unmodified** — the guard fix is upstream's.

## Build

```sh
# any Linux/macOS with the toolchain unpacked:
WASI_SDK_PATH=$HOME/wasi-sdk make

# Windows dev boxes (no local Unix toolchain): run inside WSL Ubuntu
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu bash -lc \
  'make -C /mnt/d/code/ploykit/platform/renderx/internal/qjs/csrc WASI_SDK_PATH=$HOME/wasi-sdk'
```

Output overwrites `../wasm/quickjs.wasm`; the Makefile prints its sha256.
Link flags and their rationale are commented in the Makefile; two constants
must stay in sync with `platform/renderx/engine.go`:

- `STACK_SIZE` ↔ `WasmShadowStackSize` (the Go side caps `MaxStackSize` at
  `WasmShadowStackSize − 1MiB` so the catchable guard always trips before the
  physical wall).
- `INITIAL_MEMORY` must exceed the linker's `__stack_pointer` init value
  (BSS end + `STACK_SIZE`); wasm-ld fails the link with a clear error if not.

## Verify after a (re)build

```sh
go test ./platform/renderx/ -run 'TestStackProbe|TestMaxStackSize' -count=1 -v
```

- `TestStackProbe_DeepRecursionRendersUnderDefaultBudget` / `..._GuardTripsCatchablyAndInstanceSurvives` /
  `..._BudgetRaisesCeiling` pin the restored guard's behavior (catchable trip,
  instance survival, budget effectiveness).
- `TestMaxStackSizeAbovePhysicalRejected` pins the construction-time cap.

Measured boundaries (simple recursion frames) for the current binary:
~3.1k @ 1MiB budget (defaults), ~8.1k @ 7MiB (`MaxLogicalStackSize`).
Bumping quickjs-ng can move these — re-run the probes and update the numbers
in `platform/renderx/engine.go` comments if needed.

Current artifact sha256 (printed by `make`):

```
c9dd1724c422dd659579988f4f8a4267293a61e0c8efc48748e8dd758f88e4df
```

(Debug sections are stripped — the binary is ~760KB vs the old 1MB
upstream artifact; function names for stack traces are preserved via the
`name` section.)
