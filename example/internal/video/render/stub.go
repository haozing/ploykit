//go:build !capx

package render

import (
	"context"

	videoapp "myproduct/internal/video/app"
)

// stubPipeline is the default build: the capx pipeline is compiled out, so
// every render attempt fails with ErrNotConfigured. The worker state machine
// (running → failed → quota release → audit → WS) still executes, which keeps
// the failure observable instead of silent.
type stubPipeline struct{}

func (stubPipeline) Run(_ context.Context, _ *Worker, _ renderRow, _ *videoapp.IR, _ videoapp.RenderParams, _ func(int)) (string, string, error) {
	return "", "", ErrNotConfigured
}

func pickPipeline(deps WorkerDeps) pipeline { return stubPipeline{} }

// SetCapxRuntime is a no-op on the default build: CapxRuntime (and the
// whole capx pipeline) only exists under the capx tag, so main.go can call
// this unconditionally and the default build simply discards the injection.
func SetCapxRuntime(_ any) {}
