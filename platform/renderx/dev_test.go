package renderx

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newDevFixture(t *testing.T, interval time.Duration) (*DevHandler, *atomic.Int32, *spaStub) {
	t.Helper()
	dir := t.TempDir()
	entry := filepath.Join(dir, "entry-server.tsx")
	if err := os.WriteFile(entry, []byte("export default {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var builds atomic.Int32
	newRenderer := func(bundle []byte, opts PoolOptions) (Renderer, error) {
		n := builds.Add(1)
		return newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
			return fmt.Sprintf("<main>build-%d-%s</main>", n, location), titleSink("dev"), nil
		}), nil
	}
	spa := &spaStub{}
	dh, err := NewDevHandler(DevHandlerDeps{
		BuildOpts:   BuildOptions{EntryPoints: []string{entry}, AbsWorkingDir: dir},
		NewRenderer: newRenderer,
		Cache:       newMemOnlyCache(t, "dev", 16, 0),
		Routes:      handlerTestRoutes(),
		Registry:    newHandlerTestReg(),
		SPA:         spa,
		Interval:    interval,
	})
	if err != nil {
		t.Fatal(err)
	}
	return dh, &builds, spa
}

func bumpEntry(t *testing.T, dh *DevHandler) {
	t.Helper()

	entry := dh.buildOpts.EntryPoints[0]
	if !filepath.IsAbs(entry) && dh.buildOpts.AbsWorkingDir != "" {
		entry = filepath.Join(dh.buildOpts.AbsWorkingDir, entry)
	}
	// Rewrite the file instead of os.Chtimes: on CI runners the utimes-only
	// mtime bump proved invisible to the polling watcher (rebuild never fired
	// in 30s, builds stayed 1, no rebuild warnings), while a real content
	// edit — what the watcher actually exists to serve — is unambiguous.
	if err := os.WriteFile(entry, []byte("export default {} // bump\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDevHandlerRebuildOnChange(t *testing.T) {
	dh, builds, _ := newDevFixture(t, 20*time.Millisecond)
	defer dh.Close()

	first := body(t, get(t, dh, "/"))
	if !strings.Contains(first, "build-1-/") {
		t.Fatalf("初始响应 = %q, want build-1", first)
	}
	if got := body(t, get(t, dh, "/")); got != first {
		t.Fatalf("二次请求应吃内存缓存:\n%q\n%q", first, got)
	}
	if b := builds.Load(); b != 1 {
		t.Fatalf("初始构建次数 = %d, want 1", b)
	}

	bumpEntry(t, dh)
	// 30s instead of a snappier 5s: the rebuild runs a real esbuild pass and
	// CI runners (2 shared vCPUs, full suite at -p 2) starve it for seconds —
	// 5s failed every CI run while passing instantly on dev machines.
	deadline := time.Now().Add(30 * time.Second)
	for {
		got := body(t, get(t, dh, "/"))
		if strings.Contains(got, "build-2-/") {
			break
		}
		if time.Now().After(deadline) {
			entry, _ := os.Stat(filepath.Join(dh.buildOpts.AbsWorkingDir, filepath.Base(dh.buildOpts.EntryPoints[0])))
			t.Fatalf("源码变更后 30s 内未重建（响应=%q, builds=%d, entryModTime=%v, fingerprint=%q）",
				got, builds.Load(), entry.ModTime(), devFingerprint(dh.buildOpts))
		}
		time.Sleep(20 * time.Millisecond)
	}
	if b := builds.Load(); b < 2 {
		t.Fatalf("重建次数 = %d, want >= 2", b)
	}

	if got := body(t, get(t, dh, "/app/dashboard")); got != "SPA-FALLBACK" {
		t.Errorf("SPA fallback = %q", got)
	}
}

func TestDevHandlerCloseStopsWatcher(t *testing.T) {
	dh, builds, _ := newDevFixture(t, 20*time.Millisecond)
	defer dh.Close()
	body(t, get(t, dh, "/"))
	base := builds.Load()

	dh.Close()
	bumpEntry(t, dh)
	time.Sleep(200 * time.Millisecond)
	if b := builds.Load(); b != base {
		t.Errorf("Close 后不应再重建: before=%d after=%d", base, b)
	}
}
