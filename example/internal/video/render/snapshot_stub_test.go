//go:build !capx

package render

import (
	"context"
	"testing"
)

// TestSnapshotterFor_StubUnwired: 默认构建（无 capx 标签）SetSnapshotter 是
// no-op，SnapshotterFor 恒 nil —— video_snapshot_frame 的 prepareSnapshot
// 依赖这个 nil 报 E_NOT_CONFIGURED（工具层测试在 adapters/mcp）。
func TestSnapshotterFor_StubUnwired(t *testing.T) {
	SetSnapshotter(nil) // 组装根在默认构建下的调用就是丢弃
	if SnapshotterFor() != nil {
		t.Fatal("stub build must never expose a snapshot bridge")
	}
	// G-07：抽帧桥接槽在 stub 构建同样恒 nil（video_render_frames 报
	// E_NOT_CONFIGURED 的依赖面）。
	if FrameExtractorFor() != nil {
		t.Fatal("stub build must never expose a frame extractor bridge")
	}
	// MultiFor(nil) → nil：批量眼与单帧眼共享同一个降级信号。
	if MultiFor(nil) != nil {
		t.Fatal("MultiFor(nil) must stay nil on the stub build")
	}
	// loopMulti fallback 对非 multi 桥接仍然成立（纯 Go 语义，无浏览器）。
	loop := MultiFor(loopSnapStub{})
	if loop == nil {
		t.Fatal("loop fallback must wrap any non-multi snapshotter")
	}
	res, err := loop.SnapshotMulti(context.Background(),
		SnapshotDoc{}, SnapshotSpec{Frame: 2, Width: 8, Height: 8}, []int{0, 2})
	if err != nil {
		t.Fatalf("loop multi: %v", err)
	}
	if len(res) != 2 || res[0].Frame != 0 || res[1].Frame != 2 {
		t.Fatalf("loop multi results = %v, want frames [0 2]", res)
	}
}

// loopSnapStub is a minimal non-multi Snapshotter for the loop fallback test.
type loopSnapStub struct{}

func (loopSnapStub) Snapshot(_ context.Context, _ SnapshotDoc, spec SnapshotSpec) (*SnapshotResult, error) {
	return &SnapshotResult{Frame: spec.Frame, PNG: []byte("stub"), Width: spec.Width, Height: spec.Height}, nil
}

// TestProbeFrames_StubNotConfigured: ProbeFrames（2026-11-17 转正入口）在
// stub 构建必须返回与单帧/批量眼同一个降级信号——库调用方不该看到第二种
// “能力未装配”错误。
func TestProbeFrames_StubNotConfigured(t *testing.T) {
	if _, err := ProbeFrames(context.Background(), nil, nil, []int{0}, ProbeOpts{}); err == nil {
		t.Fatal("stub build ProbeFrames must fail")
	} else if err != ErrSnapshotNotConfigured {
		t.Fatalf("stub build ProbeFrames must return ErrSnapshotNotConfigured, got %v", err)
	}
}
