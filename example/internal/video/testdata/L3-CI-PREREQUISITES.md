# L3 smoke in CI — prerequisites checklist

`TestL3Smoke` (this file's sibling `l3_smoke_test.go`) is the formalized L3
production-fidelity lane: it builds and starts the real `example/cmd/app`
binary (`-tags capx`), drives the full chain over HTTP, and asserts terminal
state by direct DB queries. This document is the checklist for wiring it into
`.github/workflows/verify.yml` — it deliberately does NOT change the workflow
(that is a separate cost/decision), because the prerequisites below are not
met by the current `example` job.

## Why it is not picked up today

Two independent reasons:

1. **Go tooling skips `testdata` directories in `./...` expansion.**
   `go list ./internal/video/...` does not include
   `myproduct/internal/video/testdata` (verified 2026-11-16). Neither CI job
   (`go` / `example`) ever names the package explicitly, so the test never
   compiles or runs on CI today. The package must be targeted explicitly:
   `go -C example test -tags capx ./internal/video/testdata -run TestL3Smoke`.
2. **The `capx` build tag is never set on CI.** Even named explicitly, the
   file is `//go:build capx` and disappears from the default build — no job
   passes `-tags capx`.

## The L3 lane needs (beyond what the `example` job has)

| # | Prerequisite | Current state in verify.yml | What to add |
|---|---|---|---|
| 1 | PostgreSQL for `TEST_DATABASE_URL` | The `go` job HAS a `postgres:17-alpine` service on :5437, but the `example` job does NOT | Service container on the `example` job (or run L3 in the `go` job with `working-directory: example`, like the existing `internal/fidelity` step) |
| 2 | `TEST_DATABASE_URL` env | Set only on the `go` job's integration step and the fidelity step | Set on the step that runs TestL3Smoke |
| 3 | `//go:build capx` tag | No job uses `-tags capx` | `-tags capx` on the test invocation |
| 4 | **Chrome** (any Chrome-family binary; `capx.ProbeChrome` checks PATH then default install locations; Linux relies on PATH) | ubuntu-latest runners have **no Chrome preinstalled** | `browser: chrome` action (e.g. `browser-actions/setup-chrome`) or `apt-get install -y chromium-browser`; then export `CAPX_TEST_CHROME=<path>` (the test helper honors it) to skip PATH ambiguity |
| 5 | **ffmpeg** on PATH | ubuntu-latest runners have **no ffmpeg preinstalled** | `apt-get install -y ffmpeg` (or a setup-ffmpeg action); `ffmpegPath()` uses plain `exec.LookPath("ffmpeg")` |
| 6 | `PLOYKIT_MCP_ENABLED=1` | Never set in CI | Export it — `=0` gates the capx runtime off and every render 503s `E_NOT_CONFIGURED` (round4 §1.4) |
| 7 | Go build cache for the second module | `example` job caches via `cache-dependency-path: example/go.sum` | Keep; the test builds `./cmd/app` itself (~1min cold) — budget the step timeout accordingly |
| 8 | Step timeout | Default 360min | Recommend `timeout-minutes: 15` on the step: local full run is ~31s render + ~5s boot + build |
| 9 | Job-level `-p 1` consideration | example job runs `go test ./...` (other packages) | Run TestL3Smoke as its own step (it binds a random free port and self-cleans the DB tables `video_render`/`video_project`/`quota_counter`/`quota_consume_idem`/`audit_event`) — do NOT mix into the parallel `go test ./...` step: the test wipes video-domain rows on the shared DB |

## Skip semantics (why a half-met list silently turns green)

The test **skips** (not fails) when any of these is missing:

- `TEST_DATABASE_URL` unset
- no Chrome found (`chromePath` → `t.Skip`)
- no ffmpeg found (`ffmpegPath` → `t.Skip`)

A CI lane that wires the DB but forgets Chrome/ffmpeg would report "ok
(skipped)" and false-positive green. **The workflow step should assert
presence before running**: e.g. `command -v ffmpeg && [ -n "$CAPX_TEST_CHROME"
]` as a hard precondition, or grep the output for `SKIP` and fail on it. This
is the single most important item on the list.

## What the DB-side run costs

Local reference runs (2026-11-16, postgres:16-alpine :5437, Windows host,
real Chrome + ffmpeg): PASS 28.67s / 28.49s consecutive, including the binary
build. Observed flake source: on a heavily loaded host the FIRST boot after a
fresh DB (migrations at boot) exceeded the test's 30s /healthz window once —
warm DB + warm build cache stayed comfortably under it. CI cold caches
reduce, not eliminate, this; the step's `timeout-minutes` (not the test's
health window) is the right place for headroom.

## Minimal viable workflow snippet (for the future decision)

```yaml
  video-l3:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: pk, POSTGRES_PASSWORD: pk, POSTGRES_DB: pk }
        ports: [ '5437:5432' ]
        options: >-
          --health-cmd "pg_isready -U pk -d pk" --health-interval 5s
          --health-timeout 3s --health-retries 12
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: example/go.mod, cache-dependency-path: example/go.sum }
      - uses: browser-actions/setup-chrome@v1
        id: chrome
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: |
          command -v ffmpeg >/dev/null || { echo "ffmpeg missing"; exit 1; }
          go -C example test -tags capx ./internal/video/testdata \
            -run TestL3Smoke -v -timeout 10m
        env:
          TEST_DATABASE_URL: postgres://pk:pk@localhost:5437/pk?sslmode=disable
          CAPX_TEST_CHROME: ${{ steps.chrome.outputs.chrome-path }}
          PLOYKIT_MCP_ENABLED: '1'
        timeout-minutes: 15
```

(The `SKIP` guard: since all three prerequisites are asserted above the test
invocation — DB reachable via the service healthcheck, ffmpeg via the
`command -v`, Chrome via the setup action — a skip at that point indicates a
real regression in discovery, not a missing tool.)

## Related, already safe

The four untagged packages in `testdata/` (l1 render, c04/c06, golden sanity,
DOM probe) run under plain `go test ./internal/video/testdata` — verified to
compile tag-free; their browser needs are `-short`-gated (`testing.Short()`)
or skip on probe failure, and CI's default-build runs never name the
`testdata` package explicitly anyway. Only the L3 file is `//go:build capx`.
