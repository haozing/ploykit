// Package video is the example product implementation of the agent video
// studio (docs/plan-agent-video-studio-architecture-2026-11-14.md §4). It is
// an example domain, not a framework domain: it imports only platform/*
// packages plus stdlib and adapts quota/identity/notify/audit through the
// app.Ports interfaces injected at wiring time (main.go), preserving
// promotability (zero import rewrites if it graduates into the framework).
//
// Domain layout mirrors the task domain:
//
//	app/       IR contract + validation + anchor resolution (pure functions),
//	           ProjectService (single mutation entry: FOR UPDATE + optimistic
//	           lock + re-resolve + audit + committed WS push), projector
//	           (IR → self-contained HTML), subtitle builder (words → SRT).
//	adapters/  HTTP routes (REST + preview.html + Range file serving),
//	           MCP tools (12 video_* tools), TTS/Aligner HTTP adapters.
//	render/    river worker driving the render pipeline (capx isolated behind
//	           the "capx" build tag; default build returns ErrNotConfigured).
//
// Invariants:
//   - every SQL statement carries a workspace_id predicate (tenant isolation);
//   - element/audio srcs must be video/<wsID>/ storage keys (SSRF narrowing);
//   - renders are quota-gated (fail-closed) and audited end to end;
//   - preview HTML ships with hash-based CSP and no-store.
package video
