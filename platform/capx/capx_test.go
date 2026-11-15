package capx_test

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/haozing/ploykit/platform/capx"
)

func boolPtr(b bool) *bool { return &b }

// chromeTestPath locates a real chrome-family executable for opt-in tests
// (CAPX_TEST_CHROME env override, then PATH, then default install paths).
// Tests skip when none is found — CI has no browser.
func chromeTestPath(t *testing.T) string {
	t.Helper()
	if p := testChromePath(); p != "" {
		return p
	}
	for _, name := range []string{"chrome", "google-chrome", "chromium", "msedge"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	for _, p := range defaultChromeLocationsForTest() {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p
		}
	}
	t.Skip("no chrome-family browser found; set CAPX_TEST_CHROME to run capx render tests")
	return ""
}

// testChromePath reads the CAPX_TEST_CHROME env override.
func testChromePath() string { return os.Getenv("CAPX_TEST_CHROME") }

// defaultChromeLocationsForTest mirrors the package's platform defaults.
func defaultChromeLocationsForTest() []string {
	switch runtime.GOOS {
	case "windows":
		rel := filepath.Join("Google", "Chrome", "Application", "chrome.exe")
		paths := make([]string, 0, 3)
		for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "LocalAppData"} {
			if root := os.Getenv(env); root != "" {
				paths = append(paths, filepath.Join(root, rel))
			}
		}
		return paths
	case "darwin":
		return []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
	default:
		return nil
	}
}

// ffmpegTestPath locates ffmpeg for opt-in tests; tests skip when missing.
func ffmpegTestPath(t *testing.T) string {
	t.Helper()
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	t.Skip("ffmpeg not found on PATH; install it to run capx encode tests")
	return ""
}

func TestNew_GatedOffIsInert(t *testing.T) {
	r, err := capx.New(capx.Config{Enabled: boolPtr(false)})
	if err != nil {
		t.Fatalf("New(enabled=false) returned error: %v", err)
	}
	if r == nil {
		t.Fatal("New returned nil runtime for disabled config")
	}
	if r.Available() {
		t.Error("inert runtime must not be Available")
	}
	if err := r.Close(); err != nil {
		t.Errorf("Close on inert runtime: %v", err)
	}
}

func TestNew_NilEnabledCountsAsFalse(t *testing.T) {
	r, err := capx.New(capx.Config{})
	if err != nil {
		t.Fatalf("New(nil enabled) returned error: %v", err)
	}
	if r.Available() {
		t.Error("nil Enabled must behave as disabled")
	}
}

func TestGating_AllMethodsReturnErrNotConfigured(t *testing.T) {
	r, err := capx.New(capx.Config{Enabled: boolPtr(false)})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	rend, err := r.Renderer()
	if !errors.Is(err, capx.ErrNotConfigured) {
		t.Fatalf("Renderer on inert runtime: got %v, want ErrNotConfigured", err)
	}
	if rend != nil {
		t.Errorf("Renderer on inert runtime must return nil renderer, got %v", rend)
	}
	inert := &capx.LocalChromeRenderer{Runtime: r}
	if err := inert.RenderFrames(t.Context(), capx.Doc{HTML: "<html></html>", TimelineID: "t"},
		capx.FrameSpec{Width: 8, Height: 8, FPS: 1, DurationFrames: 1},
		func(ctx context.Context, f capx.Frame) error { return nil }); !errors.Is(err, capx.ErrNotConfigured) {
		t.Errorf("RenderFrames on inert runtime: got %v, want ErrNotConfigured", err)
	}

	if err := r.EncodePNGStream(t.Context(), io.Discard,
		capx.FrameSpec{Width: 8, Height: 8, FPS: 1, DurationFrames: 1}, nil,
		capx.EncodeOptions{}); !errors.Is(err, capx.ErrNotConfigured) {
		t.Errorf("EncodePNGStream on inert runtime: got %v, want ErrNotConfigured", err)
	}

	if err := r.MuxAV(t.Context(), io.Discard, "v.mp4", "", "", 0.1); !errors.Is(err, capx.ErrNotConfigured) {
		t.Errorf("MuxAV on inert runtime: got %v, want ErrNotConfigured", err)
	}

	if err := r.BurnSubtitles(t.Context(), "v.mp4", "s.srt", io.Discard); !errors.Is(err, capx.ErrNotConfigured) {
		t.Errorf("BurnSubtitles on inert runtime: got %v, want ErrNotConfigured", err)
	}

	if err := r.ExtractThumbnail(t.Context(), "v.mp4", io.Discard); !errors.Is(err, capx.ErrNotConfigured) {
		t.Errorf("ExtractThumbnail on inert runtime: got %v, want ErrNotConfigured", err)
	}

	if _, err := r.Renderer(); !errors.Is(err, capx.ErrNotConfigured) {
		t.Errorf("Renderer on inert runtime: got %v, want ErrNotConfigured", err)
	}
}

func TestNew_ExplicitChromePathIsAvailable(t *testing.T) {
	chrome := chromeTestPath(t)
	ffmpeg := ffmpegTestPath(t)
	r, err := capx.New(capx.Config{
		Enabled:    boolPtr(true),
		ChromePath: chrome,
		FFMpegPath: ffmpeg,
	})
	if err != nil {
		t.Fatalf("New with explicit paths: %v", err)
	}
	if !r.Available() {
		t.Error("runtime with explicit chrome+ffmpeg paths must be Available")
	}
	rend, err := r.Renderer()
	if err != nil {
		t.Fatalf("Renderer: %v", err)
	}
	if rend == nil {
		t.Fatal("Renderer returned nil without error")
	}
	if err := r.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}
}

func TestProbeChrome_ExplicitPathWins(t *testing.T) {
	chrome := chromeTestPath(t)
	p, err := capx.ProbeChrome(chrome)
	if err != nil {
		t.Fatalf("ProbeChrome(explicit): %v", err)
	}
	if p != chrome {
		t.Errorf("ProbeChrome(explicit) = %q, want %q", p, chrome)
	}
	if _, err := capx.ProbeChrome(filepath.Join(t.TempDir(), "missing-browser")); err == nil {
		t.Error("ProbeChrome with nonexistent explicit path must fail")
	}
}

func TestProbeFFMpeg_ExplicitPath(t *testing.T) {
	ffmpeg := ffmpegTestPath(t)
	p, err := capx.ProbeFFMpeg(ffmpeg)
	if err != nil {
		t.Fatalf("ProbeFFMpeg(explicit): %v", err)
	}
	if p != ffmpeg {
		t.Errorf("ProbeFFMpeg(explicit) = %q, want %q", p, ffmpeg)
	}
	if _, err := capx.ProbeFFMpeg(filepath.Join(t.TempDir(), "missing-ffmpeg")); err == nil {
		t.Error("ProbeFFMpeg with nonexistent explicit path must fail")
	}
}

func TestRemoteHTTP_NotWired(t *testing.T) {
	var remote capx.RemoteHTTP
	err := remote.RenderFrames(t.Context(), capx.Doc{}, capx.FrameSpec{}, func(ctx context.Context, f capx.Frame) error {
		return nil
	})
	if !errors.Is(err, capx.ErrRemoteNotWired) {
		t.Errorf("RemoteHTTP.RenderFrames = %v, want ErrRemoteNotWired", err)
	}
}
