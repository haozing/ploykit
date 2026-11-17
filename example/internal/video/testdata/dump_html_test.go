//go:build capx

package l1

// Probe tool: project the pilot IR to a self-contained HTML file so the
// author can inspect per-frame DOM truth (element transforms, visibility,
// window sets) with a plain browser script BEFORE committing to a full
// render. This is the stopgap for the plan's R4 feedback-layer gap
// (ProbeFrames is not a first-class capability yet — see
// plan-video-studio-ir-v2 §3.4); when ProbeFrames lands, delete this file.
//
// Run: go -C example test -tags capx ./internal/video/testdata -run TestDumpToolsiteHTML -count=1

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/haozing/ploykit/platform/storagex"
	videoapp "myproduct/internal/video/app"
)

func TestDumpToolsiteHTML(t *testing.T) {
	pilotDir := os.Getenv("TOOLSITE_PILOT_DIR")
	if pilotDir == "" {
		pilotDir = `D:\code\tool-site\.runtime\videos\studio-pilot`
	}
	raw, err := os.ReadFile(filepath.Join(pilotDir, "ir.json"))
	if err != nil {
		t.Skipf("pilot ir not baked: %v", err)
	}
	ir := &videoapp.IR{}
	if err := json.Unmarshal(raw, ir); err != nil {
		t.Fatal(err)
	}
	assetDir := filepath.Join(pilotDir, "assets")
	proj := videoapp.NewProjector(videoapp.DataURIResolver{
		Loader: func(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			b, err := os.ReadFile(filepath.Join(assetDir, filepath.Base(key)))
			if err != nil {
				return nil, storagex.Object{}, err
			}
			return io.NopCloser(bytes.NewReader(b)), storagex.Object{Key: key, ContentType: "image/png", Size: int64(len(b))}, nil
		},
	})
	html, err := proj.HTML(context.Background(), ir, "")
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(pilotDir, "projected.html")
	if err := os.WriteFile(out, html, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("projected → %s (%d bytes)", out, len(html))
}
