# ADR 0017 · Agent Video Studio: IR-driven video output on a single projection contract

**Status:** Accepted (2026-11-15). Scope: `platform/capx` + the `video` product domain in example (`example/internal/video`: app, adapters, render worker, testdata case library) + example wiring (REST, MCP tools, WS scope, preview, river render client, quota keys, UI routes). Design baseline: docs/plan-agent-video-studio-architecture-2026-11-14.md (v2.0 decision table D1–D12). Empirical evidence: docs/delivery-audit-video-studio-2026-11-15.md and the four test-round records (round1–4).

## Context

Multi-agent products need a video-ized output engine: agents author scripts, timelines, animations, effects, voiceover and subtitles for short-form video, then export MP4. Video Studio is that engine. The governing framing — the same intent-level philosophy as ADR 0014 — is that agents manipulate a structured intermediate representation (IR) with word-level temporal anchors, never pages or DOM. The agent says "highlight the second occurrence of this word"; the projector decides how that becomes pixels. Agents never write HTML, CSS, or JavaScript.

The rendering contract is deliberately owned, not borrowed from an engine: a self-contained HTML document (vendored GSAP + timeline builder + player shell, IR embedded in a non-executing JSON data block, assets inlined as data URIs, hash-pinned CSP, network blocked) whose GSAP timeline is constructed paused and advanced by explicit per-frame `seek`. Preview (iframe + postMessage) and export (headless Chrome screenshot loop piped into ffmpeg) are two consumers of one document.

Not adopting an engine (Remotion was the considered alternative) is a decision, not an oversight: Remotion implies a Node toolchain and a renderer sidecar/fleet for export, while ploykit products are single Go binaries with Chrome and ffmpeg as managed subprocesses. The cost — we own the timeline builder, the player shell, and the frame-clock semantics (one `ceil` formula shared by Go, JS, and ffmpeg) — is accepted, and the testing rounds repeatedly justified it: every D-01-class defect lived in exactly that owned layer, where it could be found and fixed.

## Decisions

1. **Frame capture is a platform package, `platform/capx` (D1).** Headless-browser frame capture (chromedp) and ffmpeg piping enter the platform layer with zero business dependencies; the video domain programs against capx interfaces (RenderFrames / EncodePNGStream / MixAV / SoftSubtitles / thumbnail) and never imports chromedp directly. A `Renderer` interface keeps the seam where a remote render farm can later slot in; `remote.go` is that boundary declaration only — example does not wire it, and this unwired status is declared in docs (wiring-discipline boundary clause). Env-gated and off by default: missing Chrome/ffmpeg degrades only the video capability, diagnosably (probe errors surfaced), never silently.

2. **The semantic IR is the single source of truth (D4, D8, D11).** All creative state lives in the IR document; the project row keeps only operational metadata (title, row version, timestamps). No duplicated truths: the redundant `script` column was removed, and the row-level optimistic-lock `version` lives on the table only — the document carries `schemaVersion` (structure identity) and never a copy of the lock version. Types are registered once in an append-only registry consumed by UI, renderer, and MCP alike. Word anchors: v1 agents address words by `{text, occurrence}`, resolved server-side (exact match; a duplicated word without `occurrence` is an explicit ambiguity error, never auto-nearest). The decided evolution path is stable `wordId` as reference identity (diff/LCS realignment on SetScript, `unresolved` anchors surfaced as warnings, nearest-repair only behind an explicit `repair=true`): text is a selector, not an identity.

3. **One projection function: preview and render consume the same HTML (D3).** `RenderHTML` projects IR into the self-contained document, and both the preview iframe and the headless renderer consume that same output. The D-01 lesson makes this load-bearing: "counter digits never render on seek" turned out to be three stacked defects (GSAP `pause(t)` suppressing `onUpdate`; a contrast default; z-index occlusion) — three implementation bugs under a correct "same projection" architecture. Because both surfaces share one projector, each fix converged in one place (capx `seekTimeline`, builder defaults) and healed preview and export simultaneously; with two projections this bug class would have diverged per surface, and the "DOM has it, pixels don't" layer would have been invisible to preview entirely.

4. **Async rendering on river, with snapshot freeze and transactional quota (D2, D9, D10).** Rendering runs on a dedicated river client (separate queue and drain window — minute-scale `SoftStopTimeout`, deliberately NOT events' 45s), executing at-least-once with idempotent workers. Submission freezes the render: IR snapshot + render recipe (schemaVersion, projector/capx versions, pinned chrome/ffmpeg, fonts, asset manifest, quota_period), so later edits cannot alter what an in-flight job renders. One short DB transaction covers quota `ConsumeWithTx` (the framework Tx variants — quota keeps its own tables and ledger semantics, video consumes via port), the render-row insert, and river `InsertTx` (mechanisms per the compat doc). Terminal failure releases in the same transaction against the original `quota_period` with release idempotency (conditional status UPDATE + affected-rows checks — a river retry must not release twice). Client-side submission idempotency (`Idempotency-Key` / `request_id`, `UNIQUE(workspace_id, submission_key)`) returns the same render row on network retry.

5. **mcpx carries the agent face; REST carries the human face (D5).** The `video_*` MCP tool family gives agents fine-grained writes (set_script, upsert_element, animate_element, add_effect_at_word, set_audio, render, snapshot_frame, …) without one REST path per operation; REST carries the human editor surface (coarse-grained full-IR replace, preview, files, render history) plus the script-to-video catalog/compose pair. Both funnel into the same domain-service `Mutate` path — one validation, one authorization check, one audit trail, one optimistic lock. This extends ADR 0014's mcpx from dev tooling to product capability, and 0014's dev-stage exemptions do not carry over: video tools are PAT-only (browser-session and pat-all credentials rejected — the implementation enforces this at entry in `requireToolScope` in `example/internal/video/adapters/mcp/tools.go`, which rejects any non-`webx.SourcePAT` principal and then checks `Principal.Scope.Allows(toolScope)`; a `Scope == nil` (pat-all) credential does not satisfy the scope check and is rejected), and production requires per-principal rate limits on /mcp. The tool count is deliberately not pinned in this ADR: it was 11 at acceptance and has grown since the agent-tool roadmap (docs/plan-video-studio-agent-tools-2026-11-16.md) landed — treat the registry in `example/internal/video/adapters/mcp/tools.go` as the source of truth (`grep -c "mcpAdd(" ...`), with the catalog summarized in docs/api-index.md.

6. **Two-layer authorization: roles are the authority, membership is defense-in-depth (D6).** `authz.CanIn` over the role matrix (`video:read/write/render`) is the server-side authority at every entry point — REST, MCP tools, and file downloads alike; membership answers "is this principal in this workspace" and never substitutes for a role permission; PAT workspace scope is enforced at tool entry. The audit's N2 finding is the cautionary tale: a missing wsMW wrapper left principals without WorkspaceID, membership matched nothing, and video REST returned blanket 403 for everyone (fail-closed by accident), while registered-but-unconsumed permission keys let members bypass `video:render`. Both layers must be wired and actually consumed, or the authorization matrix is fiction.

7. **Quota fail-closed, with a deployment-order constraint (D7).** A workspace whose plan does not declare `video_renders_monthly` is denied rendering — an undeclared key means "not entitled", not "unlimited" (deliberate capability gating; hard mode answers 402). The example migration lands the plan quota keys in the same release as the capability: deploying code before the `plan.limits` key turns every render into a rejection — that is the documented deployment order, not a defect. The one standing exception (`idempotency_recorded`) remains: the idempotency-record mechanism is itself part of quota accounting and must not self-lock.

## Build shape and runtime boundary (2026-11-17)

The render pipeline is **build-tag gated**: `example/internal/video/render/render_pipeline.go`
and `snapshot.go` carry `//go:build capx`, and `stub.go` carries `//go:build !capx`.

- **Production builds must use `-tags capx`** — `go build -tags capx ./cmd/app`
  (example/Makefile `build`, example/Dockerfile, and the CI example job all do this).
  Only the tagged build compiles `platform/capx` and the chromedp dependency tree, so only
  it can actually render. `SetCapxRuntime` / `SetSnapshotter` are no-ops in the default
  build, so the composition root in `main.go` is tag-portable and calls them unconditionally.
- **The default (untagged) build is a stub by design** — `go build ./cmd/app` still builds
  and every non-render path works, but every render attempt returns `ErrNotConfigured`
  (503 `E_NOT_CONFIGURED`), and `video_snapshot_frame` degrades the same way. It exists so
  the domain, HTTP surface and tests stay buildable without Chrome/chromedp in the
  toolchain; it is not a deployable production shape. `example/Makefile` exposes it as
  `build-stub` explicitly to keep the intent visible.
- Capability is still gated **at runtime** on top of the build tag: `capx.Config.Enabled`
  is wired from `PLOYKIT_MCP_ENABLED`, and Chrome/ffmpeg discovery (`CAPX_CHROME_PATH` →
  PATH → platform install paths, `CAPX_FFMPEG_PATH` → PATH) can fail. A capx build on a
  host without Chrome/ffmpeg therefore boots green and degrades per request — which is
  why a capx-tagged build is safe to ship into an image that mounts the binaries later.
- **Adapter boundary declaration (AGENTS.md boundary clause): the TTS and Aligner adapters
  are implemented but not wired in example.** `example/internal/video/adapters/tts` and
  `.../adapters/aligner` exist and are unit-tested behind their own constructors, but
  `example/cmd/app/main.go` never constructs them and never assigns `Ports.Synth` /
  `Ports.Aligner`, so `VIDEO_TTS_URL` / `VIDEO_TTS_KEY` / `VIDEO_TTS_VOICE` /
  `VIDEO_ALIGNER_URL` **have no effect today** — `SetScript` always falls back through the
  degrade chain to estimated word timings (`words_source=estimated`). Product consumers who
  want real TTS/alignment must wire the adapters at their own composition root; example
  deliberately declares this as an unwired boundary rather than shipping dead config.

## Implementation and testing lessons

Unusually for an ADR, this one records empirical lessons from four test rounds (docs/delivery-audit-video-studio-round1-2026-11-15.md through round4); they are contract-level facts future work must respect:

- **Assembly gaps are only caught end-to-end (F3).** `CapxRuntime` was declared "injected at wiring time" but never assigned in main.go — every package test passed because only a test file assigned it; the first full-chain smoke failed at render submission within 97ms. A port left nil at the composition root is invisible below the integration layer; milestone gates must include a real L3 smoke (round4).
- **DOM probes cannot prove pixel state (D-01, layer 3).** Counter digits existed in `textContent` yet were absent from screenshots — z-index occlusion under data-URL rendering. Render assertions must pair DOM probes with pixel probes; "the DOM has it" is not evidence that "the frame has it".
- **HTML/script context escaping is a trap for data blocks.** html/template escapes a string interpolated inside `<script type="application/json">` as a JS expression (a quoted string literal), so `JSON.parse(textContent)` returned a string rather than an object and the preview player was silently inert (audit finding N1). Data blocks go through text/template or manual assembly, preserving `\u003c` + `</` double-escaping, with `</script>` / U+2028 / U+2029 injection tests.
- **GSAP `pause(t)` suppresses events by default.** The single-argument form defaults `suppressEvents=true`, suppressing `onUpdate` — the callback counters use to write digits. Frame-accurate seeking must call `tl.pause(t, false)` (capx `seekTimeline`).
- **Segment MP4s carry no usable `nb_frames`.** Container frame-count metadata is absent for these outputs; frame-count assertions must use ffprobe `nb_read_packets` (or decoded counts), never `nb_frames` (round1 L2).
- Also recorded (round4): the capx capability gate currently reuses `PLOYKIT_MCP_ENABLED` — a known coupling to revisit if a product ever wants MCP without capx.

## Consequences

Positive

- Single deployable unit: API + render worker in one Go binary, Chrome and ffmpeg as managed subprocesses; no Node sidecar, no render fleet to operate.
- Determinism is verifiable rather than asserted: 100 independent renders × 30 frames, every frame SHA-256-equal (round3 L5); fixed-mirror golden tests plus the render recipe make any output reproducible and explainable after the fact.
- The defect-excavation pattern is validated: four rounds surfaced 30+ issues (a 33-item ledger by round4) including four P0-class finds — F-DB-1 (create failing on every fresh database), D-01's three layers, F3's wiring gap — with the parallel audit adding N1/N2. Most of these were invisible to package-level tests. Layered adversarial testing (L0 pure-function → L1 still-frame → L2 encoded MP4 → L3 full chain → L5 consistency) is now a proven pattern for this repo.

Negative

- chromedp and ffmpeg are real environment dependencies. Degradation is probe-based and diagnosable, but rendering requires both; `go test -race` for capx remains blocked by the Windows cgo/msys2 toolchain (environment issue, tracked, not a repo defect).
- No cross-machine pixel promises: bit-identical holds only within a pinned mirror (fixed Chrome/ffmpeg/fonts/dependencies); across OS/GPU/Chrome versions, output is compared under visual tolerance only (D12's definition of determinism).
- D-01-class bugs — stacked implementation defects beneath a correct architecture — are still only exposed by real rendering: the pure-function and DOM layers stayed green through all three layers of D-01. Every milestone must budget real-render lanes (L1/L2) to catch them.

Non-goals

- No distributed or remote rendering in v1 (`remote.go` is a boundary declaration; the trigger is measured queue pressure, not anticipation).
- No professional editor surface: no drag-and-drop timeline editor, multi-camera, color grading, or keyframe editors.
- No arbitrary HTML/React/user-JavaScript execution: the player is a closed contract (vendored GSAP + builder, hash-pinned CSP, network blocked) — agents author IR, not code.
- No cross-mirror bit-identical guarantee.

## References

- docs/plan-agent-video-studio-architecture-2026-11-14.md — v2.0 design baseline, decision table D1–D12
- docs/plan-agent-video-studio-compat-2026-11-14.md — compatibility assessment; quota `ConsumeWithTx`/`ReleaseTx` mechanisms, deployment-order constraint
- docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md — case library and L0–L5 test plan
- docs/delivery-audit-video-studio-2026-11-15.md — five-lane code audit (P0/P1 register; N1 projector data block, N2 wsMW gap)
- docs/delivery-audit-video-studio-round1-2026-11-15.md, round2, round3, round4 — four empirical test-round records (D-01 three-layer root cause, F3 assembly gap, L5 100× equality, first full-chain success)
- docs/adr/0014-agent-eyes-and-hands.md — mcpx precedent (PAT scope model, mount convention, dev-stage exemptions this ADR retires)
