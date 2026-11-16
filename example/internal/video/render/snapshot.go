//go:build capx

// snapshot.go implements the Snapshotter bridge (video_snapshot_frame MCP
// tool, agent 的视觉反馈回路) over the capx Runtime. Only this file imports
// platform/capx on the snapshot path — keeping the default build free of the
// chromedp dependency tree, same as render_pipeline.go.
//
// 单帧渲染语义：capx 的 seek 是任意跳转（tl.pause(t, false) + 双 rAF flush，
// D-01 修复后回调在 seek 中也触发），帧 i 的画面只取决于 (doc, spec, i)。
// 复用 Renderer.RenderFrames(DurationFrames: frame+1) 逐帧推进到目标帧、
// onFrame 命中目标帧时捕获后以哨兵错误中止——seek 直跳与逐帧到目标帧的截帧
// 语义完全一致，且走与整片渲染相同的代码路径（投影/D-01 语义单一来源）；
// 哨兵中止保证不产生后续帧开销（本路径无编码器，逐帧推进只是 DOM seek），
// 300 帧（10s@30fps）内秒级完成。
package render

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"time"

	"github.com/haozing/ploykit/platform/capx"
)

// errSnapshotCaptured is the sentinel onFrame error: it stops RenderFrames
// right after the target frame is captured (the PNG bytes are already in
// hand). capx wraps onFrame errors with fmt.Errorf("...: %w"), so errors.Is
// unwraps back to this sentinel deterministically.
var errSnapshotCaptured = errors.New("snapshot: target frame captured (intentional abort)")

// errSnapshotAllCollected is the multi-frame sentinel: every requested frame
// has been captured and the walk can stop early. Only used when the highest
// requested frame is below the last frame of the projection walk — otherwise
// RenderFrames returns normally on its own.
var errSnapshotAllCollected = errors.New("snapshot: all target frames captured (intentional abort)")

// snapshotCache is the LRU + TTL cache keyed by (CacheVersion, frame, w, h).
// 命中即 cached:true——agent 反复看同一帧零成本。容量 32 张、TTL 5 分钟：
// IR 版本做键的一部分，版本一变旧条目永远命不中（靠 TTL 兜底回收），所以
// 不需要主动失效。
type snapshotCache struct {
	mu      sync.Mutex
	maxEnt  int
	ttl     time.Duration
	tick    uint64 // 单调序号：Windows time.Now() 粒度粗，LRU 用计数器不用时钟
	entries map[string]snapshotCacheEntry
}

type snapshotCacheEntry struct {
	res      *SnapshotResult
	cachedAt time.Time
	lastTick uint64
}

func newSnapshotCache() *snapshotCache {
	return &snapshotCache{maxEnt: 32, ttl: 5 * time.Minute, entries: map[string]snapshotCacheEntry{}}
}

func snapshotCacheKey(doc SnapshotDoc, spec SnapshotSpec) string {
	return doc.CacheVersion + "|" + doc.TimelineID + "|" +
		itoaInt(spec.Frame) + "|" + itoaInt(spec.Width) + "x" + itoaInt(spec.Height)
}

// itoaInt is strconv.Itoa minus the import (both builds of this package
// already carry a local itoa-free style; keeping it local avoids touching
// shared.go's tag-free surface).
func itoaInt(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// get returns the cached capture or nil (miss/expired).
func (c *snapshotCache) get(k string) *SnapshotResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[k]
	if !ok {
		return nil
	}
	if time.Since(e.cachedAt) > c.ttl {
		delete(c.entries, k)
		return nil
	}
	c.tick++
	e.lastTick = c.tick
	c.entries[k] = e
	return e.res
}

// put stores one capture, evicting the least-recently-used entry beyond the
// capacity bound.
func (c *snapshotCache) put(k string, res *SnapshotResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tick++
	c.entries[k] = snapshotCacheEntry{res: res, cachedAt: time.Now(), lastTick: c.tick}
	if len(c.entries) <= c.maxEnt {
		return
	}
	// O(n) LRU victim scan — n ≤ 33, cheaper than a heap. lastTick 单调且
	// 无并列（每次 get/put 都递增），victim 完全确定。
	victim := ""
	var oldest uint64
	first := true
	for key, e := range c.entries {
		if first || e.lastTick < oldest {
			victim, oldest, first = key, e.lastTick, false
		}
	}
	delete(c.entries, victim)
}

// capxSnapshotter captures single frames via Runtime.Renderer().RenderFrames
// with an aborting onFrame at the target index.
type capxSnapshotter struct {
	rt *capx.Runtime
}

func (s capxSnapshotter) Snapshot(ctx context.Context, doc SnapshotDoc, spec SnapshotSpec) (*SnapshotResult, error) {
	if s.rt == nil || !s.rt.Available() {
		return nil, ErrSnapshotNotConfigured
	}
	renderer, err := s.rt.Renderer()
	if err != nil {
		return nil, err
	}
	target := spec.Frame
	// Frames up to and including the target. Frame N's pixels depend only on
	// its own seek (arbitrary-jump pause + double rAF), so walking 0..N and
	// stopping there is capture-identical to a direct seek — single code path
	// with the full render pipeline is the point.
	var got *capx.Frame
	renderErr := renderer.RenderFrames(ctx,
		capx.Doc{HTML: string(doc.HTML), TimelineID: doc.TimelineID},
		capx.FrameSpec{
			Width: spec.Width, Height: spec.Height, FPS: spec.FPS,
			DurationFrames: target + 1,
		},
		func(_ context.Context, f capx.Frame) error {
			if f.Index == target {
				fc := f
				got = &fc
				return errSnapshotCaptured // stop the loop; bytes in hand
			}
			return nil
		})
	if renderErr != nil && !errors.Is(renderErr, errSnapshotCaptured) {
		return nil, renderErr
	}
	if got == nil {
		// Should not happen (DurationFrames = target+1 guarantees the callback
		// fires at target), but fail closed rather than hand back a zero PNG.
		return nil, errors.New("video snapshot: capture loop produced no frame")
	}
	return &SnapshotResult{
		PNG:            got.PNG,
		Width:          spec.Width,
		Height:         spec.Height,
		Frame:          got.Index,
		DurationFrames: spec.DurationFrames,
	}, nil
}

// SnapshotMulti renders every frame in frames from ONE projection walk
// (video_preview_frames)：文档投影与浏览器起页只付一次，逐帧 seek 是唯一
// 的逐帧成本——这正是多帧批量眼相对 N 次单帧调用的全部收益。onFrame 命中
// 任一目标帧就收集、不中止；收齐全部目标帧后用 errSnapshotAllCollected
// 哨兵提前中止（最高目标帧 = 最后一帧时 RenderFrames 自行正常返回）。帧
// 序（frame N 的像素只取决于 (doc, spec, N)）与单帧路径 byte-identical，
// 走同一条投影/D-01 语义单一来源。
func (s capxSnapshotter) SnapshotMulti(ctx context.Context, doc SnapshotDoc, base SnapshotSpec, frames []int) ([]SnapshotResult, error) {
	if s.rt == nil || !s.rt.Available() {
		return nil, ErrSnapshotNotConfigured
	}
	renderer, err := s.rt.Renderer()
	if err != nil {
		return nil, err
	}
	// 去重升序（调用方已保证非空，这里再防御一次），哨兵提前中止只在
	// 最高目标帧 < DurationFrames-1 时启用。
	targets := append([]int(nil), frames...)
	sortInts(targets)
	lastTarget := targets[len(targets)-1]
	if lastTarget > base.DurationFrames-1 {
		lastTarget = base.DurationFrames - 1
	}
	want := map[int]bool{}
	for _, f := range targets {
		if f >= 0 && f <= base.DurationFrames-1 {
			want[f] = true
		}
	}
	got := map[int]capx.Frame{}
	earlyStop := lastTarget < base.DurationFrames-1
	renderErr := renderer.RenderFrames(ctx,
		capx.Doc{HTML: string(doc.HTML), TimelineID: doc.TimelineID},
		capx.FrameSpec{
			Width: base.Width, Height: base.Height, FPS: base.FPS,
			DurationFrames: lastTarget + 1,
		},
		func(_ context.Context, f capx.Frame) error {
			if want[f.Index] {
				fc := f
				got[f.Index] = fc
				if len(got) == len(want) {
					if earlyStop {
						return errSnapshotAllCollected
					}
					// 收齐且已是最后一帧：正常返回即可（返回 nil 继续无谓
					// 地走完剩余帧，直接哨兵同样会被 errors.Is 放行——这里
					// 选择让循环自然结束，语义最干净）。
				}
			}
			return nil
		})
	if renderErr != nil && !errors.Is(renderErr, errSnapshotAllCollected) {
		return nil, renderErr
	}
	out := make([]SnapshotResult, 0, len(frames))
	for _, f := range targets {
		fc, ok := got[f]
		if !ok {
			// Should not happen (DurationFrames covers every target), but
			// fail closed rather than hand back a zero PNG.
			return nil, errors.New("video snapshot: multi capture missing frame " + itoaInt(f))
		}
		out = append(out, SnapshotResult{
			PNG:            fc.PNG,
			Width:          base.Width,
			Height:         base.Height,
			Frame:          fc.Index,
			DurationFrames: base.DurationFrames,
		})
	}
	return out, nil
}

// sortInts is sort.Ints minus the import (this file keeps its dependency
// surface minimal).
func sortInts(a []int) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

// cachedSnapshotter wraps any Snapshotter with the version-keyed cache.
type cachedSnapshotter struct {
	inner Snapshotter
	cache *snapshotCache
}

func (c cachedSnapshotter) Snapshot(ctx context.Context, doc SnapshotDoc, spec SnapshotSpec) (*SnapshotResult, error) {
	if doc.CacheVersion == "" {
		return c.inner.Snapshot(ctx, doc, spec)
	}
	k := snapshotCacheKey(doc, spec)
	if hit := c.cache.get(k); hit != nil {
		cached := *hit
		cached.Cached = true
		return &cached, nil
	}
	res, err := c.inner.Snapshot(ctx, doc, spec)
	if err != nil {
		return nil, err
	}
	c.cache.put(k, res)
	return res, nil
}

// SnapshotMulti applies the per-frame cache to the batch path: hits skip the
// projection walk entirely (all-hit = zero browser work), a miss batch goes
// through the inner bridge once and every captured frame lands in the cache
// (a later single-frame call on the same version then hits). The inner
// snapshotter is typed as the minimal Snapshotter interface, so a non-multi
// inner falls back to the per-frame loop (semantics identical, used only by
// test doubles).
func (c cachedSnapshotter) SnapshotMulti(ctx context.Context, doc SnapshotDoc, base SnapshotSpec, frames []int) ([]SnapshotResult, error) {
	inner, hasMulti := any(c.inner).(SnapshotMulti)
	if !hasMulti {
		inner = loopMulti{snap: c.inner}
	}
	if doc.CacheVersion == "" {
		return inner.SnapshotMulti(ctx, doc, base, frames)
	}
	out := make([]SnapshotResult, 0, len(frames))
	misses := map[int]int{} // frame → position in out (patch after the walk)
	for _, f := range frames {
		spec := base
		spec.Frame = f
		if hit := c.cache.get(snapshotCacheKey(doc, spec)); hit != nil {
			cached := *hit
			cached.Cached = true
			out = append(out, cached)
			continue
		}
		misses[f] = len(out)
		out = append(out, SnapshotResult{Frame: f})
	}
	if len(misses) == 0 {
		return out, nil
	}
	missFrames := make([]int, 0, len(misses))
	for f := range misses {
		missFrames = append(missFrames, f)
	}
	fresh, err := inner.SnapshotMulti(ctx, doc, base, missFrames)
	if err != nil {
		return nil, err
	}
	for _, res := range fresh {
		c.cache.put(snapshotCacheKey(doc, SnapshotSpec{Width: base.Width, Height: base.Height, FPS: base.FPS, Frame: res.Frame}), &res)
		out[misses[res.Frame]] = res
	}
	return out, nil
}

// SetSnapshotter overrides the shared.go no-op for the capx build: installs
// the runtime-backed cached bridge. The `any` parameter mirrors
// SetCapxRuntime so the main.go call site is tag-portable (the default
// build's stub discards the value).
func SetSnapshotter(v any) {
	rt, _ := v.(*capx.Runtime)
	snapshotter = cachedSnapshotter{inner: capxSnapshotter{rt: rt}, cache: newSnapshotCache()}
	frameExtractor = runtimeFrameExtractor{rt: rt}
}

// runtimeFrameExtractor is the 成品抽帧 half of the bridge (video_render_
// frames): capx.ExtractFrameAt pipes one lossless PNG from the encoded MP4
// straight into memory — the encoded truth the IR snapshots cannot show
// (burned/soft subtitles, muxing, compression artifacts).
type runtimeFrameExtractor struct{ rt *capx.Runtime }

func (e runtimeFrameExtractor) ExtractFrame(ctx context.Context, videoPath string, sec float64) ([]byte, error) {
	if e.rt == nil || !e.rt.Available() {
		return nil, ErrFrameExtractNotConfigured
	}
	var buf bytes.Buffer
	if err := e.rt.ExtractFrameAt(ctx, videoPath, sec, &buf); err != nil {
		return nil, err
	}
	if buf.Len() == 0 {
		// ffmpeg produced zero frames at this seek point (sec past the end
		// of the stream): report it rather than hand back an empty image.
		return nil, errors.New("video render frames: no frame at that time (past the end of the output?)")
	}
	return buf.Bytes(), nil
}
