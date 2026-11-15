package capx

import (
	"context"
	"errors"
)

// RemoteHTTP is the declared extension point for a remote render server
// (design §3.5). The Renderer interface is the slot: a future distributed
// deployment implements Renderer over HTTP against a HyperFrames
// Producer-style render farm and swaps the implementation at the assembly
// layer, with zero changes to the video domain — the engine-side mirror of
// the "IR does not bind to HTML details" decision (external design draft,
// decision 5).
//
// Boundary (AGENTS.md boundary clause): RemoteHTTP is NOT wired in v1 — no
// product consumes it, example wires only the LocalChrome path (Runtime).
// This file exists so the extension point has a declared, documented home;
// when a remote renderer becomes real, replace these stubs with an
// implementation and record the consumption boundary in the docs that wired
// it. Do not ship a half-wired protocol here.
//
// When to reach for it: render throughput saturating one machine's browser
// pool, or a deployment shape where browsers live on dedicated GPU workers.

// ErrRemoteNotWired is returned by every RemoteHTTP method until a real
// implementation lands. It mirrors ErrNotConfigured: diagnosable, not silent
// — callers can distinguish "capability gated off" from "remote renderer
// declared but not implemented".
var ErrRemoteNotWired = errors.New("capx: remote renderer is a declared extension point and is not wired in this release (use Runtime.Renderer / LocalChrome)")

// RenderFrames stub satisfies the Renderer interface shape so that a future
// implementation compiles against the same contract tests.
func (RemoteHTTP) RenderFrames(ctx context.Context, doc Doc, spec FrameSpec, onFrame FrameFunc) error {
	return ErrRemoteNotWired
}

// RemoteHTTP marks the remote renderer extension point; see the file comment
// for the wiring boundary.
type RemoteHTTP struct{}
