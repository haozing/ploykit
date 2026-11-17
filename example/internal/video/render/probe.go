//go:build capx

package render

import (
	"context"
	"errors"
	"fmt"

	videoapp "myproduct/internal/video/app"
)

// ProbeFrames is the promoted「全渲前探帧」entry (2026-11-17, ProbeFrames
// 转正): it packages the three steps the test harnesses had been assembling
// by hand (testdata/probe_frames_test.go was the demonstration) into one
// exported call —
//
//  1. project: NewProjector(assets).HTML(ir) — the SAME self-contained
//     document the render pipeline produces (assets nil = preview resolver;
//     pass a videoapp.DataURIResolver over storagex for the render-truth
//     document);
//  2. capture: the installed snapshot bridge (SnapshotterFor →
//     SnapshotMulti) — one projection walk + one browser page for the whole
//     batch, per-frame seek the only per-frame cost; the content-keyed LRU
//     applies when the bridge is the cached capx one (CacheScope "" here —
//     a library caller has no tenant identity to scope by, so ProbeFrames
//     itself never serves a cached hit; wire video_preview_frames' MCP tool
//     path when tenant-scoped caching is wanted);
//  3. shape: results in caller order as ProbeResult.
//
// Degradation mirrors every other bridge consumer: an unwired snapshotter
// (default build / inert runtime) returns ErrSnapshotNotConfigured — the
// single stable not-configured signal of this package.
//
// DOMState TRADE-OFF (deliberate, documented): ProbeResult carries a
// DOMState field but this implementation leaves it nil — the snapshot
// bridge's onFrame callback receives only (Index, Time, PNG) with no page
// handle, so a same-frame DOM scan would require an evaluation hook inside
// platform/capx's frame loop (a Renderer contract change, out of this
// increment's scope). DOM assertions keep using the inspectable-tab pattern
// demonstrated by testdata/probe_dom_test.go (chromedp session + seek +
// getComputedStyle scan); when capx grows an onFrame DOM-eval hook, fill
// DOMState here without touching the signature.
func ProbeFrames(ctx context.Context, ir *videoapp.IR, assets videoapp.AssetResolver,
	frames []int, opts ProbeOpts) ([]ProbeResult, error) {
	if ir == nil {
		return nil, errors.New("video probe: ir is required")
	}
	if len(frames) == 0 {
		return nil, errors.New("video probe: frames is empty")
	}
	width, height, fps := opts.Width, opts.Height, opts.FPS
	if width == 0 {
		width = ir.Meta.Width
	}
	if height == 0 {
		height = ir.Meta.Height
	}
	if fps == 0 {
		fps = ir.Meta.FPS
	}
	total := videoapp.DurationFrames(ir, fps)
	for _, f := range frames {
		if f < 0 || f > total-1 {
			return nil, fmt.Errorf("video probe: frame %d outside [0, durationFrames-1=%d]", f, total-1)
		}
	}
	snap := SnapshotterFor()
	if snap == nil {
		return nil, ErrSnapshotNotConfigured
	}
	html, err := videoapp.NewProjector(assets).HTML(ctx, ir, "")
	if err != nil {
		return nil, fmt.Errorf("video probe: project: %w", err)
	}
	dedup := dedupFrames(frames)
	res, err := MultiFor(snap).SnapshotMulti(ctx,
		SnapshotDoc{HTML: html, TimelineID: "main"},
		SnapshotSpec{Width: width, Height: height, FPS: fps, DurationFrames: total},
		dedup)
	if err != nil {
		return nil, err
	}
	out := make([]ProbeResult, 0, len(res))
	for _, r := range res {
		out = append(out, ProbeResult{Frame: r.Frame, PNG: r.PNG, DOMState: nil})
	}
	return out, nil
}

// dedupFrames returns the sorted distinct frame numbers (SnapshotMulti's
// contract takes a deduped slice; caller order is restored by ProbeFrames
// mapping results back by frame).
func dedupFrames(frames []int) []int {
	seen := make(map[int]bool, len(frames))
	out := make([]int, 0, len(frames))
	for _, f := range frames {
		if !seen[f] {
			seen[f] = true
			out = append(out, f)
		}
	}
	sortIntsLocal(out)
	return out
}

// sortIntsLocal is sort.Ints minus the import (this file keeps a thin
// dependency surface, mirroring snapshot.go's local helpers).
func sortIntsLocal(a []int) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}
