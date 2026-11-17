//go:build capx

package l1

// probe_frames_test.go —「全渲前秒级探针」工作流的 Go 原生示范（上轮试点是
// dump_html + node 脚本手工拼的，本轮把它搬进 harness）。
//
// 动机：studio-pilot 全渲（TestToolSiteAssembly，441 帧）要 ~3 分钟才能看到
// 第一张成片；探针只走一次投影 + 一次浏览器起页 + 逐帧 seek 到目标帧就截，
// 3 帧（30/200/400）秒级返回——出片前先肉眼确认版式/动画推进，再决定是否
// 付全渲的钱。这正是 MCP video_preview_frames 工具背后同一条桥：
//
//	render.SnapshotterFor()  ← render.SetSnapshotter(capxRuntime) 装配
//	   └─ cachedSnapshotter{ capxSnapshotter{rt} }（render/snapshot.go）
//	        └─ SnapshotMulti：一次投影 walk 收全部目标帧 + 哨兵早停 + LRU 缓存
//
// 装配说明：SetSnapshotter(v any) 是导出的、收 *capx.Runtime——与生产装配根
// example/cmd/app/main.go:1269 (videorender.SetSnapshotter(capxRuntime)) 完全
// 同一条路径，测试直接复用即可，无需为 capxSnapshotter（小写）另加导出构造
// 函数，也不存在与 main.go 的重复装配逻辑需要收敛。
//
// Run: go -C example test -tags capx ./internal/video/testdata -run TestProbeFramesPilot -v -count=1 -timeout 10m
//
// Skips when TOOLSITE_PILOT_DIR (default D:\code\tool-site\.runtime\videos\
// studio-pilot) has no ir.json — same gate as TestToolSiteAssembly.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/haozing/ploykit/platform/storagex"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
	videorender "myproduct/internal/video/render"
)

func TestProbeFramesPilot(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser probe; skipped in -short mode")
	}
	pilotDir := os.Getenv("TOOLSITE_PILOT_DIR")
	if pilotDir == "" {
		pilotDir = `D:\code\tool-site\.runtime\videos\studio-pilot`
	}
	assetDir := filepath.Join(pilotDir, "assets")
	if _, err := os.Stat(filepath.Join(pilotDir, "ir.json")); err != nil {
		t.Skipf("pilot assets not baked yet (%s): %v", pilotDir, err)
	}

	// -- 1. IR: load + validate + resolve（投影前必须 ResolveAll，锚点塌缩会
	// 让整个编排缩到 t=0 —— round-9 教训，与 toolsite harness 同款门）--
	raw, err := os.ReadFile(filepath.Join(pilotDir, "ir.json"))
	require.NoError(t, err)
	ir := &videoapp.IR{}
	require.NoError(t, json.Unmarshal(raw, ir))
	require.NoError(t, videoapp.Validate(ir))
	frames := videoapp.DurationFrames(ir, ir.Meta.FPS)
	for _, r := range videoapp.ResolveAll(ir, nil) {
		if r.WordIndex < 0 {
			t.Errorf("anchor %s(%s) %q unresolved", r.OwnerID, r.Owner, r.AnchorText)
		}
	}

	// -- 2. project with baked assets（资产目录加载，同 toolsite）--
	proj := videoapp.NewProjector(videoapp.DataURIResolver{
		Loader: func(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			p := filepath.Join(assetDir, filepath.Base(key))
			b, err := os.ReadFile(p)
			if err != nil {
				return nil, storagex.Object{}, fmt.Errorf("asset %q: %w", key, err)
			}
			return io.NopCloser(bytes.NewReader(b)),
				storagex.Object{Key: key, ContentType: "image/png", Size: int64(len(b))}, nil
		},
	})
	ctx := context.Background()
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)
	t.Logf("projected HTML bytes=%d, full render = %d frames @%dfps", len(html), frames, ir.Meta.FPS)

	// -- 3. runtime + snapshotter bridge（生产装配路径原样：SetSnapshotter）--
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t) // snapshot 路径本身不用 ffmpeg，但与生产装配同构
	enabled := true
	rt, err := capx.New(capx.Config{
		Enabled:    &enabled,
		ChromePath: chrome,
		FFMpegPath: ffmpeg,
		PoolSize:   1,
	})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	videorender.SetSnapshotter(rt) // = main.go:1269 的装配调用
	snap := videorender.SnapshotterFor()
	require.NotNil(t, snap, "SetSnapshotter must install the bridge")
	multi := videorender.MultiFor(snap) // capx 桥原生实现多帧路径
	require.NotNil(t, multi)

	// -- 4. the probe: 3 frames in ONE projection walk --
	// SnapshotDoc：HTML=投影后的完整文档（数据 URI 已内联）；TimelineID 与
	// 渲染管线同取 "main"；CacheScope 每次运行唯一（冷路径计时诚实，且对
	// -count>1 稳定）——生产侧是 "<workspace>/<project>/<version>"。
	doc := videorender.SnapshotDoc{
		HTML:       html,
		TimelineID: "main",
		CacheScope: fmt.Sprintf("toolsite-pilot/probe/%d", time.Now().UnixNano()),
	}
	// SnapshotSpec：几何与节拍。Frame 字段在 multi 路径按 frames 参数逐帧
	// 覆盖（base.Frame 不用填）；DurationFrames 是文档全长，multi 用它判断
	// 哨兵早停（最高目标帧 400 < 440 → 收齐即中止，不再走完剩余 40 帧）。
	base := videorender.SnapshotSpec{
		Width:          ir.Meta.Width,
		Height:         ir.Meta.Height,
		FPS:            ir.Meta.FPS,
		DurationFrames: frames,
	}
	probeFrames := []int{30, 200, 400}

	probeT0 := time.Now()
	res, err := multi.SnapshotMulti(ctx, doc, base, probeFrames)
	probeElapsed := time.Since(probeT0)
	require.NoError(t, err, "probe SnapshotMulti failed")
	require.Len(t, res, len(probeFrames))
	for i, f := range probeFrames {
		require.Equal(t, f, res[i].Frame, "results follow caller order")
		require.False(t, res[i].Cached, "first probe must be a cold capture")
		require.True(t, bytes.HasPrefix(res[i].PNG, []byte{0x89, 'P', 'N', 'G'}),
			"frame %d is not a PNG payload", f)
	}
	require.NotEqual(t, res[0].PNG, res[1].PNG, "f30 and f200 must differ (content moves)")
	fullEstimate := probeElapsed * time.Duration(frames) / time.Duration(probeFrames[len(probeFrames)-1]+1)
	t.Logf("PROBE: %d frames in %.1fs (early-stop at frame %d of %d) — full render costs ~%d frames ≈ %.0fs, see TestToolSiteAssembly's measured ~3min",
		len(probeFrames), probeElapsed.Seconds(), probeFrames[len(probeFrames)-1], frames, frames, fullEstimate.Seconds())

	// -- 5. repeat view: same doc + frames → LRU hit, zero browser work --
	// 探针经济学：反复看同一帧不付第二份浏览器钱（LRU ≤32、TTL 5min，
	// 内容摘要键——投影字节变了自然 miss）。
	repeatT0 := time.Now()
	res2, err := multi.SnapshotMulti(ctx, doc, base, probeFrames)
	repeatElapsed := time.Since(repeatT0)
	require.NoError(t, err)
	require.Len(t, res2, len(probeFrames))
	for i := range res2 {
		require.True(t, res2[i].Cached, "repeat probe frame %d must hit the cache", probeFrames[i])
		require.Equal(t, res[i].PNG, res2[i].PNG, "cache must return identical bytes")
	}
	t.Logf("REPEAT: %.0fms (all-hit, no browser round-trip)", repeatElapsed.Seconds()*1000)

	// -- 6. artifacts for human inspection --
	for i, f := range probeFrames {
		p := filepath.Join(pilotDir, fmt.Sprintf("probe-f%03d.png", f))
		require.NoError(t, os.WriteFile(p, res[i].PNG, 0o644))
	}
	t.Logf("artifacts: %s (probe-f030/f200/f400.png)", pilotDir)

	// -- 7. the promoted entry: render.ProbeFrames (2026-11-17 转正) --
	// Same IR, same bridge, one exported call — including the asset-loading
	// projection (DataURIResolver) that the manual flow spelled out above.
	// Byte identity with the manual probe above IS the promotion contract
	// (ProbeFrames projects + captures through the same single source).
	entry, err := videorender.ProbeFrames(ctx, ir, videoapp.DataURIResolver{
		Loader: func(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			p := filepath.Join(assetDir, filepath.Base(key))
			b, rerr := os.ReadFile(p)
			if rerr != nil {
				return nil, storagex.Object{}, fmt.Errorf("asset %q: %w", key, rerr)
			}
			return io.NopCloser(bytes.NewReader(b)),
				storagex.Object{Key: key, ContentType: "image/png", Size: int64(len(b))}, nil
		},
	}, []int{200}, videorender.ProbeOpts{})
	require.NoError(t, err, "ProbeFrames entry must work over the same wired bridge")
	require.Len(t, entry, 1)
	require.Equal(t, 200, entry[0].Frame)
	require.True(t, bytes.HasPrefix(entry[0].PNG, []byte{0x89, 'P', 'N', 'G'}),
		"entry result is a PNG payload")
	// The probe cache returns the manual f200 capture for this doc: same
	// bytes (content-keyed, same projection) — determinism across the two
	// call styles in one run.
	manualF200 := res[1] // probeFrames = {30, 200, 400}
	require.Equal(t, manualF200.PNG, entry[0].PNG,
		"ProbeFrames f200 must be byte-identical to the manual multi capture")
}
