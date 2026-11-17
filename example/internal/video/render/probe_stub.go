//go:build !capx

package render

import (
	"context"

	videoapp "myproduct/internal/video/app"
)

// ProbeFrames on the default build always reports the stable degradation
// signal: the snapshot bridge is compiled out (SetSnapshotter is a no-op),
// so there is no capture capability to promote. Signature mirrors probe.go
// (the capx-tagged implementation); the shared result types live in
// probe_types.go so both builds compile the same call sites.
func ProbeFrames(_ context.Context, _ *videoapp.IR, _ videoapp.AssetResolver,
	_ []int, _ ProbeOpts) ([]ProbeResult, error) {
	return nil, ErrSnapshotNotConfigured
}
