//go:build capx

package l1

// Shuijing promo — the first REAL-project showcase for the Video Studio
// pipeline: a 30s vertical (1080×1920@30) crystal-bracelet promo for
// D:\code\shuijing's bracelet editor, rendered with the REAL crystal
// thumbnails (webp, copied from shuijing/web/public/crystals/) as data URIs.
//
// The bracelet visual = N image elements arranged on a circle (mirrors
// shuijing's computeLayout ring), fully within the current IR capability
// (no code changes required — the promo proves the pipeline's expressive
// ceiling on real content).
//
// Run: go -C example test -tags capx ./internal/video/testdata -run TestShuijingPromo -v -timeout 20m

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/haozing/ploykit/platform/storagex"
	videoapp "myproduct/internal/video/app"
	"github.com/stretchr/testify/require"
)

// shuijingAssets resolves shuijing/*.webp keys from testdata/ir/shuijing/.
func shuijingAssets(served *int) videoapp.DataURIResolver {
	return videoapp.DataURIResolver{
		Loader: func(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			_, thisFile, _, _ := runtime.Caller(0)
			p := filepath.Join(filepath.Dir(thisFile), "ir", "shuijing", filepath.Base(key))
			b, err := os.ReadFile(p)
			if err != nil {
				return nil, storagex.Object{}, fmt.Errorf("shuijing asset %q: %w", key, err)
			}
			*served++
			return io.NopCloser(bytes.NewReader(b)),
				storagex.Object{Key: key, ContentType: "image/webp", Size: int64(len(b))}, nil
		},
	}
}

func TestShuijingPromo(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Dir(thisFile)

	// -- 1. IR: load + validate + resolve (batch-9 lesson: ResolveAll before
	// projection or the anchor choreography collapses to t=0) --
	raw, err := os.ReadFile(filepath.Join(baseDir, "ir", "shuijing", "promo.json"))
	require.NoError(t, err)
	ir := &videoapp.IR{}
	require.NoError(t, json.Unmarshal(raw, ir))
	require.NoError(t, videoapp.Validate(ir))
	frames := videoapp.DurationFrames(ir, ir.Meta.FPS)
	require.Equal(t, 900, frames, "ceil(30×30) = 900")
	for _, r := range videoapp.ResolveAll(ir, nil) {
		t.Logf("anchor %s(%s) %q -> word[%d] %s start=%.2fs",
			r.OwnerID, r.Owner, r.AnchorText, r.WordIndex, r.Reason, func() float64 {
				if r.WordIndex >= 0 && r.WordIndex < len(ir.Words) {
					return ir.Words[r.WordIndex].Start
				}
				return 0
			}())
	}

	// -- 2. project with REAL crystal assets --
	served := 0
	proj := videoapp.NewProjector(shuijingAssets(&served))
	html, err := proj.HTML(context.Background(), ir, "")
	require.NoError(t, err)
	t.Logf("projected HTML bytes=%d (crystal webp data URIs + @font-face)", len(html))
	require.Contains(t, string(html), "data:image/webp", "crystal thumbnails embedded as data URIs")

	// -- 3. render + encode (full 900-frame loop, real Chrome) --
	spec := capx.FrameSpec{Width: ir.Meta.Width, Height: ir.Meta.Height,
		FPS: ir.Meta.FPS, DurationFrames: frames}
	require.NoError(t, spec.Validate())

	outDir := filepath.Join(baseDir, "l3-full", "SHUIJING-PROMO")
	require.NoError(t, os.MkdirAll(outDir, 0o755))
	outPath := filepath.Join(outDir, "output.mp4")
	videoOut, err := os.Create(outPath)
	require.NoError(t, err)

	pr, pw, err := os.Pipe()
	require.NoError(t, err)
	fw := capx.NewFrameWriter(pw)

	chrome := chromePath(t)   // skips when no chrome-family browser
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
	kept := map[int]bool{30: true, 270: true, 600: true, 830: true}
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
			if f.Index%150 == 0 {
				t.Logf("frame %d/%d (%.1fs)", f.Index, frames, time.Since(frameT0).Seconds())
			}
			return nil
		})
	require.NoError(t, renderErr, "render failed")
	require.NoError(t, pw.Close())
	require.NoError(t, <-encDone)
	require.NoError(t, videoOut.Close())
	t.Logf("SHUIJING PROMO: %d frames in %.1fs (%.1f ms/frame), served %d crystal assets",
		frames, time.Since(frameT0).Seconds(), float64(time.Since(frameT0).Milliseconds())/float64(frames), served)

	// -- 4. structural assertions --
	st, err := os.Stat(outPath)
	require.NoError(t, err)
	require.Greater(t, st.Size(), int64(100000), "MP4 should be substantial (>100KB)")
	head := make([]byte, 12)
	f, _ := os.Open(outPath)
	f.Read(head)
	f.Close()
	require.Contains(t, string(head[4:]), "ftyp", "MP4 ftyp box")

	// F30 hero bead visible (crystal pink on dark bg → dark bg dominant but
	// hero bead ink present); F270 bracelet assembled (5 beads on circle).
	// Content-varying: F30 vs F270 differ substantially.
	require.NotEqual(t, samples[30], samples[270], "content changes over time")

	// -- 5. golden + meta (evidence) --
	for fr, png := range samples {
		gp := filepath.Join(outDir, fmt.Sprintf("sample-%03d.png", fr))
		require.NoError(t, os.WriteFile(gp, png, 0o644))
	}
	t.Logf("artifacts: %s (output.mp4 + %d sample PNGs)", outDir, len(samples))
}
