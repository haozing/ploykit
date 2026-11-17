//go:build capx

// snapshot_bridge_test.go: 单帧截图桥接的单元测试——缓存语义、惰性运行时
// 降级、以及（找到 Chrome 系浏览器时的）真 Chrome 单帧捕获。真 Chrome 测试
// 与 capx 包的 renderer_test.go 同款 skip 门：找不到浏览器就跳过，CI 无
// 浏览器不红。
package render

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
)

// testSnapshotDoc is a hand-built player document (same contract as the capx
// package's test doc): stub __player ready immediately, one fake timeline
// whose pause(t) paints the frame index into the background color — each
// frame's pixels provably differ, so a wrong seek shows up as a wrong color.
func testSnapshotDoc() string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; }
  #stage { width: 100vw; height: 100vh; }
</style>
</head>
<body>
<div id="stage"></div>
<script>
  (function () {
    window.__player = { ready: true };
    window.__timelines = {};
    window.__timelines["main"] = {
      pause: function (t) {
        var i = Math.round(t * 10); // fps=10 in this doc
        document.getElementById('stage').style.backgroundColor =
          'rgb(' + (i * 7 % 256) + ',' + (i * 13 % 256) + ',' + (i * 29 % 256) + ')';
      }
    };
  })();
</script>
</body>
</html>`
}

// snapshotTestRuntime mirrors the capx package's chromeTestPath gating: probe
// PATH + default install locations for a chrome-family browser; skip when
// none exists.
func snapshotTestRuntime(t *testing.T) *capx.Runtime {
	t.Helper()
	var chrome string
	for _, name := range []string{"chrome", "google-chrome", "chromium", "msedge"} {
		if p, err := exec.LookPath(name); err == nil {
			chrome = p
			break
		}
	}
	if chrome == "" {
		t.Skip("no chrome-family browser found; video snapshot bridge tests need one")
	}
	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	t.Cleanup(func() { _ = rt.Close() })
	return rt
}

// TestSnapshotCache_HitThenExpire: 命中返回同一份 PNG 且标记 cached=true；
// TTL 过后回 miss。
func TestSnapshotCache_HitThenExpire(t *testing.T) {
	c := newSnapshotCache()
	c.ttl = 30 * time.Millisecond
	doc := SnapshotDoc{CacheScope: "7", TimelineID: "main"}
	spec := SnapshotSpec{Width: 64, Height: 64, Frame: 3}
	k := snapshotCacheKey(doc, spec)

	if got := c.get(k); got != nil {
		t.Fatal("empty cache must miss")
	}
	res := &SnapshotResult{PNG: []byte("PNGDATA"), Width: 64, Height: 64, Frame: 3, DurationFrames: 30}
	c.put(k, res)

	got := c.get(k)
	if got == nil {
		t.Fatal("fresh put must hit")
	}
	if !bytes.Equal(got.PNG, res.PNG) {
		t.Fatal("hit must return the same capture")
	}

	// 版本一变（agent 改了 IR）键就变——旧条目永远命不中。
	newKey := snapshotCacheKey(SnapshotDoc{CacheScope: "8", TimelineID: "main"}, spec)
	if got := c.get(newKey); got != nil {
		t.Fatal("new version must miss the old version's entry")
	}

	time.Sleep(50 * time.Millisecond)
	if got := c.get(k); got != nil {
		t.Fatal("expired entry must miss")
	}
}

// TestSnapshotCache_LRUEviction: 超容量时淘汰最久未用的条目。
func TestSnapshotCache_LRUEviction(t *testing.T) {
	c := newSnapshotCache()
	c.maxEnt = 2
	mk := func(v string) (string, *SnapshotResult) {
		doc := SnapshotDoc{CacheScope: v, TimelineID: "main"}
		spec := SnapshotSpec{Width: 64, Height: 64, Frame: 1}
		return snapshotCacheKey(doc, spec), &SnapshotResult{PNG: []byte(v), Frame: 1}
	}
	kA, rA := mk("a")
	kB, rB := mk("b")
	c.put(kA, rA)
	c.put(kB, rB)
	// 触碰 A：B 成为 LRU 受害者。
	if c.get(kA) == nil {
		t.Fatal("precondition: A cached")
	}
	time.Sleep(2 * time.Millisecond) // 保证 lastUse 严格大于 A 的
	kC, rC := mk("c")
	_ = kC
	c.put(kC, rC)
	if c.get(kB) != nil {
		t.Fatal("LRU victim (B) must be evicted")
	}
	if c.get(kA) == nil {
		t.Fatal("recently touched A must survive")
	}
}

// TestSnapshotCache_NoCrossTenantCollision is the regression for the delivery
// audit P0: the cache key used to be the caller-supplied project version,
// which every project starts at 1 — so two unrelated projects (or two
// tenants) asking for "version 1, frame 0, 1080x1920" collided and one got
// the other's pixels. Identity is now the document digest, so distinct
// documents can never share an entry, even with identical scope/version
// strings (a caller bug must not become a data leak).
func TestSnapshotCache_NoCrossTenantCollision(t *testing.T) {
	c := newSnapshotCache()
	spec := SnapshotSpec{Width: 1080, Height: 1920, FPS: 30, Frame: 0, DurationFrames: 300}

	tenantA := SnapshotDoc{
		HTML:       []byte("<html><body>tenant A card</body></html>"),
		TimelineID: "main",
		CacheScope: "ws-a/proj-a/1",
	}
	tenantB := SnapshotDoc{
		HTML:       []byte("<html><body>tenant B card</body></html>"),
		TimelineID: "main",
		CacheScope: "ws-b/proj-b/1",
	}
	kA, kB := snapshotCacheKey(tenantA, spec), snapshotCacheKey(tenantB, spec)
	if kA == kB {
		t.Fatalf("distinct documents must not share a cache key: %q", kA)
	}
	c.put(kA, &SnapshotResult{PNG: []byte("A"), Frame: 0})
	if got := c.get(kB); got != nil {
		t.Fatal("tenant B must not read tenant A's captured frame")
	}

	// Defence in depth: even when the caller passes an IDENTICAL scope string
	// (impossible today, but the key must not depend on caller honesty) the
	// differing document keeps the entries apart.
	impostor := tenantB
	impostor.CacheScope = tenantA.CacheScope
	if got := c.get(snapshotCacheKey(impostor, spec)); got != nil {
		t.Fatal("document digest must isolate entries independently of CacheScope")
	}

	// Same document + same scope + same geometry still hits (the cache works).
	if got := c.get(snapshotCacheKey(tenantA, spec)); got == nil || !bytes.Equal(got.PNG, []byte("A")) {
		t.Fatal("identical document must still hit")
	}
}

// TestSnapshotCache_FPSIsPartOfIdentity: frame N is at t=N/fps, so two
// projects with the same floor plan but different frame rates must never
// share a capture under an equal version.
func TestSnapshotCache_FPSIsPartOfIdentity(t *testing.T) {
	doc := SnapshotDoc{HTML: []byte("<html>same</html>"), TimelineID: "main", CacheScope: "ws/p/1"}
	a := SnapshotSpec{Width: 640, Height: 360, FPS: 30, Frame: 10}
	b := a
	b.FPS = 60
	if snapshotCacheKey(doc, a) == snapshotCacheKey(doc, b) {
		t.Fatal("FPS must participate in the cache key (frame N moves with fps)")
	}
}

// TestCapxSnapshotter_InertRuntime: nil / 惰性运行时 → ErrSnapshotNotConfigured
// （agent 侧的稳定降级信号）。
func TestCapxSnapshotter_InertRuntime(t *testing.T) {
	var nilRT *capx.Runtime
	s := capxSnapshotter{rt: nilRT}
	_, err := s.Snapshot(t.Context(), SnapshotDoc{TimelineID: "main"}, SnapshotSpec{Frame: 0, Width: 64, Height: 64, FPS: 10, DurationFrames: 1})
	if !errors.Is(err, ErrSnapshotNotConfigured) {
		t.Fatalf("nil runtime: want ErrSnapshotNotConfigured, got %v", err)
	}
	// capx.New 不带 Enabled（惰性运行时）同样降级。
	inert, _ := capx.New(capx.Config{})
	s2 := capxSnapshotter{rt: inert}
	_, err = s2.Snapshot(t.Context(), SnapshotDoc{TimelineID: "main"}, SnapshotSpec{Frame: 0, Width: 64, Height: 64, FPS: 10, DurationFrames: 1})
	if !errors.Is(err, ErrSnapshotNotConfigured) {
		t.Fatalf("inert runtime: want ErrSnapshotNotConfigured, got %v", err)
	}
}

// TestSnapshotBridge_SingleFrameCapture: 真 Chrome 单帧捕获——目标帧的像素
// 与该帧的 seek 对齐（背景色由帧号推导），第二次调用回缓存（cached=true）。
func TestSnapshotBridge_SingleFrameCapture(t *testing.T) {
	rt := snapshotTestRuntime(t)
	bridge := cachedSnapshotter{inner: capxSnapshotter{rt: rt}, cache: newSnapshotCache()}
	doc := SnapshotDoc{HTML: []byte(testSnapshotDoc()), TimelineID: "main", CacheScope: "1"}
	spec := SnapshotSpec{Width: 160, Height: 90, FPS: 10, Frame: 3, DurationFrames: 30}

	res, err := bridge.Snapshot(t.Context(), doc, spec)
	if err != nil {
		t.Fatalf("first snapshot: %v", err)
	}
	if res.Cached {
		t.Fatal("first capture must not be cached")
	}
	if res.Frame != 3 {
		t.Fatalf("Frame = %d, want 3", res.Frame)
	}
	if res.Width != 160 || res.Height != 90 {
		t.Fatalf("geometry = %dx%d, want 160x90", res.Width, res.Height)
	}
	if !bytes.HasPrefix(res.PNG, []byte{0x89, 'P', 'N', 'G'}) {
		t.Fatal("capture is not a PNG payload")
	}

	again, err := bridge.Snapshot(t.Context(), doc, spec)
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}
	if !again.Cached {
		t.Fatal("repeat (version, frame, size) must hit the cache")
	}
	if !bytes.Equal(again.PNG, res.PNG) {
		t.Fatal("cache hit must return byte-identical PNG")
	}

	// 版本变了：同帧重照（不走旧缓存），仍非 cached。
	doc.CacheScope = "2"
	fresh, err := bridge.Snapshot(t.Context(), doc, spec)
	if err != nil {
		t.Fatalf("bumped-version snapshot: %v", err)
	}
	if fresh.Cached {
		t.Fatal("new version must recapture")
	}

	// 越界钳制前的帧号是调用方职责，但桥接对最后一帧必须可用：
	specLast := SnapshotSpec{Width: 160, Height: 90, FPS: 10, Frame: 29, DurationFrames: 30}
	if _, err := bridge.Snapshot(t.Context(), doc, specLast); err != nil {
		t.Fatalf("last frame snapshot: %v", err)
	}
}

// TestSetSnapshotter_WiresBridge: 组装根注入后 SnapshotterFor 返回非 nil
// 且惰性运行时的桥接报 ErrSnapshotNotConfigured（装配契约冒烟）。
func TestSetSnapshotter_WiresBridge(t *testing.T) {
	prev := snapshotter
	prevEx := frameExtractor
	t.Cleanup(func() { snapshotter = prev; frameExtractor = prevEx })

	inert, _ := capx.New(capx.Config{})
	SetSnapshotter(inert)
	bridge := SnapshotterFor()
	if bridge == nil {
		t.Fatal("SetSnapshotter must install the bridge")
	}
	_, err := bridge.Snapshot(t.Context(),
		SnapshotDoc{HTML: []byte("<html></html>"), TimelineID: "main", CacheScope: "1"},
		SnapshotSpec{Frame: 0, Width: 64, Height: 64, FPS: 10, DurationFrames: 1})
	if !errors.Is(err, ErrSnapshotNotConfigured) {
		t.Fatalf("inert wired bridge: want ErrSnapshotNotConfigured, got %v", err)
	}
	// G-07：SetSnapshotter 同时安装抽帧桥（同一 Runtime，两双眼睛一个槽位
	// 填充点）；惰性运行时抽帧同样降级。
	ex := FrameExtractorFor()
	if ex == nil {
		t.Fatal("SetSnapshotter must install the frame extractor bridge")
	}
	if _, err := ex.ExtractFrame(t.Context(), "v.mp4", 0); !errors.Is(err, ErrFrameExtractNotConfigured) {
		t.Fatalf("inert extractor: want ErrFrameExtractNotConfigured, got %v", err)
	}
}

// TestCapxSnapshotter_MultiCapture: 真 Chrome 一次投影渲染收集多帧——三帧
// 各自的像素与该帧的 seek 对齐（背景色由帧号推导），结果按调用方顺序返回，
// 第二次调用整批走缓存。这是 video_preview_frames 相对 N 次单帧调用的核心
// 语义：文档只投影一次。
func TestCapxSnapshotter_MultiCapture(t *testing.T) {
	rt := snapshotTestRuntime(t)
	bridge := cachedSnapshotter{inner: capxSnapshotter{rt: rt}, cache: newSnapshotCache()}
	doc := SnapshotDoc{HTML: []byte(testSnapshotDoc()), TimelineID: "main", CacheScope: "1"}
	base := SnapshotSpec{Width: 160, Height: 90, FPS: 10, DurationFrames: 30}

	res, err := bridge.SnapshotMulti(t.Context(), doc, base, []int{0, 5, 12})
	if err != nil {
		t.Fatalf("multi capture: %v", err)
	}
	if len(res) != 3 {
		t.Fatalf("got %d results, want 3", len(res))
	}
	wantFrames := []int{0, 5, 12}
	for i, r := range res {
		if r.Frame != wantFrames[i] {
			t.Errorf("res[%d].Frame = %d, want %d (caller order preserved)", i, r.Frame, wantFrames[i])
		}
		if r.Cached {
			t.Errorf("res[%d]: first batch must not be cached", i)
		}
		if !bytes.HasPrefix(r.PNG, []byte{0x89, 'P', 'N', 'G'}) {
			t.Errorf("res[%d] is not a PNG payload", i)
		}
	}
	// 帧间像素可证不同（错帧即错色）。
	if bytes.Equal(res[0].PNG, res[2].PNG) {
		t.Error("frame 0 and frame 12 must capture different pixels")
	}

	again, err := bridge.SnapshotMulti(t.Context(), doc, base, []int{12, 0})
	if err != nil {
		t.Fatalf("second multi capture: %v", err)
	}
	for _, r := range again {
		if !r.Cached {
			t.Errorf("frame %d: repeat batch must hit the per-frame cache", r.Frame)
		}
	}
	// 乱序调用返回调用方顺序（12, 0——不是升序 0, 12）。
	if again[0].Frame != 12 || again[1].Frame != 0 {
		t.Errorf("caller order must be preserved, got [%d, %d]", again[0].Frame, again[1].Frame)
	}

	// 重复帧去重后仍正确（0, 0, 5 → 两结果，按去重顺序）。
	dup, err := bridge.SnapshotMulti(t.Context(), doc, base, []int{5})
	if err != nil {
		t.Fatalf("dedup capture: %v", err)
	}
	if len(dup) != 1 || dup[0].Frame != 5 {
		t.Fatalf("dedup capture = %v, want [frame 5]", dup)
	}
}

// TestCapxSnapshotter_MultiLastFrame: 最高目标帧 = 最后一帧时提前中止哨兵
// 不启用、循环自然收尾——批量抽到片尾帧同样可用。
func TestCapxSnapshotter_MultiLastFrame(t *testing.T) {
	rt := snapshotTestRuntime(t)
	bridge := cachedSnapshotter{inner: capxSnapshotter{rt: rt}, cache: newSnapshotCache()}
	doc := SnapshotDoc{HTML: []byte(testSnapshotDoc()), TimelineID: "main", CacheScope: "1"}
	base := SnapshotSpec{Width: 160, Height: 90, FPS: 10, DurationFrames: 30}

	res, err := bridge.SnapshotMulti(t.Context(), doc, base, []int{28, 29})
	if err != nil {
		t.Fatalf("tail multi capture: %v", err)
	}
	if len(res) != 2 || res[0].Frame != 28 || res[1].Frame != 29 {
		t.Fatalf("tail capture = %v, want [28, 29]", res)
	}
}

// TestFrameExtractor_RealMP4: 真 ffmpeg 从编码成品抽帧（G-07 成品抽帧眼）。
// 用例库真实产物当 fixture（testdata/l2/VS-C02/output.mp4，随仓库交付）；
// ffmpeg 缺失就跳过——与 capx 包 encode_test.go 的 skip 门同款。抽出的帧
// 必须是合法 PNG，越界时间必须报错而非空图。
func TestFrameExtractor_RealMP4(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not found on PATH; video_render_frames bridge tests need it")
	}
	mp4, err := filepath.Abs(filepath.Join("..", "testdata", "l2", "VS-C02", "output.mp4"))
	if err != nil {
		t.Fatalf("resolve fixture: %v", err)
	}
	if _, err := os.Stat(mp4); err != nil {
		t.Skipf("fixture MP4 missing: %v", err)
	}

	prev := frameExtractor
	t.Cleanup(func() { frameExtractor = prev })
	enabled := true
	// capx.New 会自动探测默认 Chrome 安装位（ChromePath 空也探），有 Chrome
	// 的机器上 Available 即真——降级分支（ErrFrameExtractNotConfigured）已由
	// TestSetSnapshotter_WiresBridge 的惰性运行时覆盖，这里直接打真抽帧。
	rt, err := capx.New(capx.Config{Enabled: &enabled, FFMpegPath: ffmpeg})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	if !rt.Available() {
		t.Skip("runtime not fully available (no chrome on this machine); real-extraction assertions need it")
	}
	full := runtimeFrameExtractor{rt: rt}
	png, err := full.ExtractFrame(t.Context(), mp4, 0)
	if err != nil {
		t.Fatalf("ExtractFrame(0s): %v", err)
	}
	if !bytes.HasPrefix(png, []byte{0x89, 'P', 'N', 'G'}) {
		t.Fatal("extracted frame is not a PNG payload")
	}
	// 中段抽帧同样可用（0.5s 落在 10s 片内）。
	if _, err := full.ExtractFrame(t.Context(), mp4, 0.5); err != nil {
		t.Errorf("ExtractFrame(0.5s): %v", err)
	}
	// 越界时间：ffmpeg 产出零帧 → 明确报错（不回空图）。
	if _, err := full.ExtractFrame(t.Context(), mp4, 1e6); err == nil {
		t.Error("ExtractFrame(1e6s): want an error for a seek past the end, got nil")
	}
}
