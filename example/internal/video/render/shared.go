package render

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/haozing/ploykit/platform/storagex"
	videoapp "myproduct/internal/video/app"
)

// QuotaReleaser is the compensation port (adapter wraps quota.Service).
type QuotaReleaser interface {
	Release(ctx context.Context, workspaceID, key string, n int64, now time.Time) error
}

// quotaKeyAlias re-exports the app quota key (single source of truth).
const quotaKeyAlias = videoapp.QuotaKey

func jsonUnmarshal(b []byte, into any) error { return json.Unmarshal(b, into) }

// storagexStore aliases the store interface for the pipeline files.
type storagexStore = storagex.Store

// --- snapshot bridge (video_snapshot_frame MCP tool) ---
//
// tools.go 是无标签文件，不能 import platform/capx（chromedp 依赖树只在
// capx 标签下编译）。单帧截图与整片渲染走同一条 build-tag 隔离模式：
// 这里声明桥接接口与数据类型，stub 构建返回 ErrSnapshotNotConfigured，
// capx 构建在 snapshot.go 里实现真实捕获。工具层只依赖本文件。

// SnapshotDoc is one snapshot job's inputs — everything needed to rebuild
// the projected document deterministically (HTML 来自调用方的投影，
// TimelineID 固定 "main" 与 render pipeline 相同的取法). CacheVersion is
// the IR version string that keys the capture cache ("" = uncached caller;
// the tool layer always passes the project version).
type SnapshotDoc struct {
	HTML         []byte
	TimelineID   string
	CacheVersion string
}

// SnapshotSpec is the capture geometry + timing (mirrors capx.FrameSpec
// without the import).
type SnapshotSpec struct {
	Width, Height  int
	FPS            int
	Frame          int // 0-based target frame (caller already clamped to [0, DurationFrames-1])
	DurationFrames int
}

// SnapshotResult is one captured frame. Cached is set by the cache layer on
// a hit (the tool surfaces it so the agent knows the PNG is a repeat view of
// the same IR version).
type SnapshotResult struct {
	PNG            []byte
	Width, Height  int
	Frame          int
	DurationFrames int
	Cached         bool
}

// Snapshotter captures one frame of a projected document (the agent's
// "eyes" for the video studio). The cache (version+frame+size keyed, LRU
// ≤32, TTL 5min) is an implementation detail of the capx bridge; the stub
// never caches because it never succeeds.
type Snapshotter interface {
	Snapshot(ctx context.Context, doc SnapshotDoc, spec SnapshotSpec) (*SnapshotResult, error)
}

// SnapshotMulti renders MANY frames of ONE projected document in a single
// pass (video_preview_frames): the document projection (asset inlining) and
// the browser page are paid once, the per-frame seek is the only per-frame
// cost — N single-frame Snapshot calls would re-project and re-open the
// page N times. Results come back in the SAME order as the frames argument;
// cached true marks frames served from the capture cache. snap may fall
// back to per-frame Snapshot calls (loop-over-the-frames) — the semantics
// are identical because frame N's pixels depend only on (doc, spec, N).
type SnapshotMulti interface {
	SnapshotMulti(ctx context.Context, doc SnapshotDoc, base SnapshotSpec, frames []int) ([]SnapshotResult, error)
}

// MultiFor returns the multi-frame path of an installed bridge: the capx
// build's snapshotter implements SnapshotMulti natively; anything else
// (tests, exotic bridges) gets the generic loop fallback built on top of
// Snapshot. Nil snapshotter → nil multi (the tool degrades identically).
func MultiFor(snap Snapshotter) SnapshotMulti {
	switch v := snap.(type) {
	case nil:
		return nil
	case SnapshotMulti:
		return v
	default:
		return loopMulti{snap: v}
	}
}

// loopMulti is the universal fallback: N independent Snapshot calls. Used by
// the stub build never (stub multi is unwired) and by any non-multi bridge
// in tests; production always has the native capx implementation.
type loopMulti struct{ snap Snapshotter }

func (l loopMulti) SnapshotMulti(ctx context.Context, doc SnapshotDoc, base SnapshotSpec, frames []int) ([]SnapshotResult, error) {
	out := make([]SnapshotResult, 0, len(frames))
	for _, f := range frames {
		spec := base
		spec.Frame = f
		res, err := l.snap.Snapshot(ctx, doc, spec)
		if err != nil {
			return nil, err
		}
		out = append(out, *res)
	}
	return out, nil
}

// --- frame extractor bridge (video_render_frames MCP tool, 成品抽帧眼) ---
//
// 成品抽帧与单帧截图走同一条 build-tag 隔离模式：这里声明桥接接口，
// stub 构建槽位恒 nil（工具层报 E_NOT_CONFIGURED），capx 构建由
// SetSnapshotter 顺带安装真实现——两双眼睛吃同一个 capx.Runtime，装配根
// 保持 main.go 一处、无需新增组装点。工具层只依赖本文件。

// FrameExtractor pulls one lossless PNG frame at sec seconds out of an
// encoded video FILE (the agent's eye on the real encoded output — IR
// snapshots show the projected document, this sees the encoder's work:
// burned/soft subtitles, muxing, compression artifacts). Implementations
// pipe ffmpeg stdout into memory; nothing touches disk.
type FrameExtractor interface {
	ExtractFrame(ctx context.Context, videoPath string, sec float64) ([]byte, error)
}

// ErrFrameExtractNotConfigured is what video_render_frames gets when the
// extraction capability is unavailable — capx tag off (stub build) or the
// runtime inert (no ffmpeg). One stable degradation signal for both modes,
// mirroring ErrSnapshotNotConfigured.
var ErrFrameExtractNotConfigured = errors.New("video render frames: ffmpeg extraction not configured (build tag capx / no ffmpeg)")

// frameExtractor is the extraction bridge slot; SetSnapshotter (declared per
// build) fills it on the capx build alongside the snapshotter (same runtime).
var frameExtractor FrameExtractor

// FrameExtractorFor returns the installed extractor (nil = not wired).
func FrameExtractorFor() FrameExtractor { return frameExtractor }

// ErrSnapshotNotConfigured is what the video_snapshot_frame MCP tool gets
// when the capture capability is unavailable — either the capx tag is off
// (stub build) or the runtime is inert (no Chrome / gate closed). One stable
// degradation signal for both modes.
var ErrSnapshotNotConfigured = errors.New("video snapshot: capture capability not configured (build tag capx / no Chrome)")

// snapshotter is the snapshot bridge slot. SetSnapshotter (declared per
// build) installs it: the stub build makes the setter a no-op, the capx
// build assigns the real bridge — same pattern as SetCapxRuntime.
var snapshotter Snapshotter

// SnapshotterFor returns the installed bridge (nil = not wired). The MCP
// tool layer reads it through this exported helper so both builds compile
// the same call site.
func SnapshotterFor() Snapshotter { return snapshotter }
