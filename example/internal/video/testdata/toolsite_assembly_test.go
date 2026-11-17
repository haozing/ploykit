//go:build capx

package l1

// tool-site「托盘飞入」旗舰样片复刻（studio 表达力试点）——把 D:\code\tool-site
// 的 video-v4-assembly.mjs（Playwright 驱动 Canvas2D 编辑器逐帧截图管线）搬到
// Video Studio IR 管线上：底图 + 30 张成片位姿贴纸（move+scaleIn 飞入）+ 托盘页
// 窗口元素 + 30 个勾格 + 3 张字效 PNG，全部 manual 词锚，无配音。
//
// 资产由 tool-site web/scripts/export-studio-assets.mjs 预烘（引擎位姿透明提取），
// IR 由 web/scripts/build-studio-ir.mjs 生成；本测试只做「Validate → 投影 →
// capx 渲染 → 编码」的全链路出片。
//
// Run: go -C example test -tags capx ./internal/video/testdata -run TestToolSiteAssembly -v -timeout 20m

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
)

func TestToolSiteAssembly(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	pilotDir := os.Getenv("TOOLSITE_PILOT_DIR")
	if pilotDir == "" {
		pilotDir = `D:\code\tool-site\.runtime\videos\studio-pilot`
	}
	assetDir := filepath.Join(pilotDir, "assets")
	if _, err := os.Stat(filepath.Join(pilotDir, "ir.json")); err != nil {
		t.Skipf("pilot assets not baked yet (%s): %v", pilotDir, err)
	}

	// -- 1. IR: load + validate + resolve（round-9 教训：投影前必须 ResolveAll，
	// 否则整个锚点编排塌缩到 t=0）--
	raw, err := os.ReadFile(filepath.Join(pilotDir, "ir.json"))
	require.NoError(t, err)
	ir := &videoapp.IR{}
	require.NoError(t, json.Unmarshal(raw, ir))
	require.NoError(t, videoapp.Validate(ir))
	frames := videoapp.DurationFrames(ir, ir.Meta.FPS)
	require.Equal(t, 441, frames, "ceil(14.67×30) = 441")
	for _, r := range videoapp.ResolveAll(ir, nil) {
		if r.WordIndex < 0 {
			t.Errorf("anchor %s(%s) %q unresolved", r.OwnerID, r.Owner, r.AnchorText)
		}
	}

	// -- 2. project with baked assets --
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
	html, err := proj.HTML(context.Background(), ir, "")
	require.NoError(t, err)
	t.Logf("projected HTML bytes=%d (66 elements inlined as data URIs)", len(html))

	// -- 3. render + encode (full 441-frame loop, real Chrome) --
	spec := capx.FrameSpec{Width: ir.Meta.Width, Height: ir.Meta.Height,
		FPS: ir.Meta.FPS, DurationFrames: frames}
	require.NoError(t, spec.Validate())

	outDir := pilotDir
	outPath := filepath.Join(outDir, "studio-ir.mp4")
	videoOut, err := os.Create(outPath)
	require.NoError(t, err)

	pr, pwr, err := os.Pipe()
	require.NoError(t, err)
	fw := capx.NewFrameWriter(pwr)

	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
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
	rend, err := rt.Renderer()
	require.NoError(t, err)

	encDone := make(chan error, 1)
	go func() {
		encErr := rt.EncodePNGStream(context.Background(), videoOut, spec, pr, capx.EncodeOptions{CRF: 18, Preset: "medium"})
		pr.Close()
		encDone <- encErr
	}()

	frameT0 := time.Now()
	kept := map[int]bool{8: true, 60: true, 200: true, 365: true, 430: true}
	samples := map[int][]byte{}
	renderErr := rend.RenderFrames(context.Background(),
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if err := fw.WriteFrame(f.PNG); err != nil {
				return err
			}
			if kept[f.Index] {
				samples[f.Index] = f.PNG
			}
			if f.Index%100 == 0 {
				t.Logf("frame %d/%d (%.1fs)", f.Index, frames, time.Since(frameT0).Seconds())
			}
			return nil
		})
	require.NoError(t, renderErr, "render failed")
	require.NoError(t, pwr.Close())
	require.NoError(t, <-encDone)
	require.NoError(t, videoOut.Close())
	t.Logf("TOOLSITE ASSEMBLY: %d frames in %.1fs (%.1f ms/frame)",
		frames, time.Since(frameT0).Seconds(), float64(time.Since(frameT0).Milliseconds())/float64(frames))

	st, err := os.Stat(outPath)
	require.NoError(t, err)
	require.Greater(t, st.Size(), int64(200000), "MP4 should be substantial")
	require.NotEqual(t, samples[8], samples[200], "content changes over time")

	for fr, png := range samples {
		gp := filepath.Join(outDir, fmt.Sprintf("studio-ir-f%03d.png", fr))
		require.NoError(t, os.WriteFile(gp, png, 0o644))
	}
	t.Logf("artifacts: %s (studio-ir.mp4 + %d sample PNGs)", outPath, len(samples))
}
