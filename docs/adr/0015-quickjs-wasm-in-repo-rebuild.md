# ADR 0015 · QuickJS wasm rebuilt in-repo: engine version pinned, stack guard restored

**Status:** Accepted (2026-10-16). Closes rendering.md R13 ("fork engine recursion-depth-limit defect") and ROADMAP's "QuickJS stack-depth fix at the root". Follows the #15/#16 field walks (shuijing: one extra `<div>` layer killed a prerender with an opaque `out of bounds memory access`).

## Background

Two underlying facts were established by measurement during the #16 investigation:

1. **The embedded wasm had no in-repo build recipe.** `platform/renderx/internal/qjs/wasm/quickjs.wasm` was byte-identical to the prebuilt artifact shipped by `Gaurav-Gosain/quickjs` @ `65b9e11` (sha256 `c64eaccb…`). The engine inside it is **quickjs-ng 0.11.0**, compiled with wasi-sdk 29 and wasm-ld's **default 64KiB shadow stack**. Neither the quickjs-ng version nor the stack size was a reviewable choice — they were inherited.

2. **`PoolOptions.MaxStackSize` was a silent no-op on that build.** quickjs-ng before v0.17.0 compiled `update_stack_limit()` to `stack_limit = 0 /* no limit */` under `__wasi__` — the JS-level guard was disabled on the theory that wasm engines provide their own recursion protection. Measured consequence: 1MiB and 16MiB budgets both died at ~999 frames with an uncatchable wasm trap, there was no "logical budget" at all, and the only real wall was the 64KiB shadow stack. Worse, a trap corrupts the instance's stack pointer: every subsequent render on that instance failed too (measured: a trivial render right after an overflow still trapped), so one deep page poisoned a pooled instance for its lifetime.

The mitigation chain before this ADR (raises to 1MiB default, two-ceiling error hint, 16MB ceiling pin, depth guidance in rendering.md §4.3) was honest about the state but could not cure it: no knob reached the wall.

Upstream fixed the root cause: quickjs-ng PR **#1700** ("Add WASI configurable stack overflow protection", in **v0.17.0**, released 2026-09-18) removes the `__wasi__` guard-disable, making `JS_SetMaxStackSize` effective on wasi and converting recursion overflow back into a catchable `InternalError: Maximum call stack size exceeded`.

## Decision

**Build the embedded wasm in-repo from reviewed sources, pin the engine version, and restore the guard with a physical stack that the guard can always outrun.**

1. **`platform/renderx/internal/qjs/csrc/`** now vendors the exact sources and build recipe:
   - `bridge.c` — from Gaurav-Gosain/quickjs @ `65b9e11` (the wazero glue the Go binding was vendored from), carrying two ploykit modifications documented in `csrc/README.md`: `ARENA_SIZE` 4MiB→8MiB (Go writes each SSR bundle through this arena; large products' bundles sat within 1MiB of the old ceiling) and `arena_alloc()` fail-fast for oversize singles instead of wrapping to offset 0 and overrunning adjacent static data.
   - `quickjs-ng/` — **unmodified** quickjs-ng **v0.17.0** (`6d46d07`; the guard fix is upstream's).
   - `Makefile` + `build.sh` — pin every flag. Two load-bearing numbers: `-z stack-size=8388608` (8MiB physical shadow stack) and `--initial-memory=25165824` (must exceed `__stack_pointer`'s init value or the link fails).

2. **Go engine surface reflects the two-tier reality** (`platform/renderx/engine.go`):
   - `WasmShadowStackSize` (8MiB) mirrors the linked stack; `MaxLogicalStackSize = WasmShadowStackSize − 1MiB` is the largest accepted budget, **enforced at `NewEnginePool`** — recursion can no longer reach the physical wall, so the uncatchable trap is unreachable by depth.
   - Guard trips (`Maximum call stack size exceeded` / `stack overflow`) get a hint naming the budget and the cap and explicitly state that the instance is healthy. The wasm-trap branch is now framed as "should be unreachable" and **retires the instance** (trap-path self-healing; previously a trapped instance limped on as a zombie).
   - The binding also passes `JS_UpdateStackTop` duties through existing calls, and the wasm is ~760KB after `--strip-debug` (vs the old 1MB artifact) while preserving the `name` section for stack-trace symbolization.

3. **Regression pins** (engine_test.go): default-budget deep recursion renders (2000 frames); overflow trips catchably at 5000 frames with the budget hint and the same instance survives; the 7MiB cap raises the ceiling; a 16MiB budget is rejected at construction naming the physical stack.

Measured boundaries for the shipped binary, simple recursion frames: **~3.1k @ 1MiB (default)**, **~8.1k @ 7MiB (cap)**. Re-run the probes when bumping quickjs-ng and re-base the numbers in `engine.go` comments if they move.

## Boundary and non-goals

- **No CGo, no new dependency**: the build runs offline against a local wasi-sdk; the shipped artifact is the same `//go:embed` wasm consumed by the same wazero bridge. Products see no API change except that `MaxStackSize` now works and above-cap values error at construction.
- **Not a per-request SSR enabler.** The guard's capacity is per-render stack; the N1 "no real-time SSR" decision (no JIT, 30–120ms/page) is untouched.
- **Not a sandbox boundary change**: memory limits (`MemoryLimit`), execution timeout, and the arena contract are unchanged.
- **Rebuild stays manual/blessed**, not part of `make verify`: toolchain acquisition (wasi-sdk) and binary review are deliberate steps; the `csrc/README.md` procedure plus the regression pins are the guardrails. CI can adopt a rebuild-and-diff check later if drift becomes a real risk (the artifact is embedded, so drift is visible in diffs).

## Consequences

Positive
- The #15/#16 failure class is cured, not mitigated: deep trees now fail with an actionable, catchable JS error that names the knob; raising the knob demonstrably raises the ceiling (3.1k→8.1k frames); a guard trip no longer poisons pooled instances (verified by probe and pinned by test).
- The engine version is now a reviewed pin (quickjs-ng v0.17.0, the fork AWS LLRT tracks via rquickjs) rather than an unknown; upgrading is a one-line change plus a probe re-run.
- The R13 avoidance contract in §4.3 (minimal server-side wrap) can be relaxed when a real need appears — full-provider SSR is no longer blocked by a 64KiB wall, only by its own stack appetite within the 8MiB/7MiB budget.

Negative
- The repository now carries ~2.9MB of vendored C sources and a manual build step to keep in sync when quickjs-ng is bumped. Accepted: this was the only way to pin the engine, and the csrc README + pins make the step mechanical.
- `build.sh` duplicates the Makefile flags; both point at the same constants and `csrc/README.md` documents the sync contract (STACK_SIZE ↔ `WasmShadowStackSize`, INITIAL_MEMORY vs BSS+stack).
- Two numbers (measured frame boundaries) in `engine.go` comments are environment-derived; they are comments, not assertions — tests assert ordering/thresholds with margin instead.

## Alternatives considered

- **Raise only the wasm stack via wasm-opt/patched binary without a recipe** — rejected: unreviewable, no version pin, and #16 already proved the wall matters; a 64KB→8MB patch without the guard fix still means traps, just deeper.
- **Stay on quickjs-ng 0.11.0 + patch the guard ourselves** — rejected once v0.17.0 was verified to contain upstream PR #1700; carrying a local engine patch when the upstream fork fixed it is strictly worse.
- **Evaluator swap (goja / V8 via CGo / per-request Node)** — rejected earlier by the PoC (rendering.md §5.4): CGo violates G6, goja lacks the SSR-relevant fidelity, Node reintroduces the deployment dependency renderx exists to remove.
