package fidelity

// Prerender fidelity gate: the SSR bundle must render through the REAL
// renderx QuickJS engine with the product's actual provider stack.
//
// This lane exists because of a real escape (2026-10-19): the TanStack router
// adapter's rawParseSearch used URLSearchParams.forEach, which exists in
// browsers and Node but NOT in the renderx QuickJS prelude shim — every test
// passed, CI was green, `go build` was green, and the example's prerender died
// with "not a function" the moment it ran inside the sandbox. The cold-boot
// lane covers HTTP/registration/provisioning; it never renders SSR pages, so
// the whole SSR bundle class was ungated.
//
// What this test does: build the example's real SSR bundle (same
// BuildSSRBundle call the product uses, same aliases including the TanStack
// isServer alias), boot the real engine pool with the product prelude, ask it
// for routes, and render the home page + warm blog pages — asserting non-empty
// HTML with expected content. It needs no database: pages under test are
// loader-free (the pass-through blog list page renders from its route table),
// so it runs in any CI environment with node_modules present.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/renderx"
	"myproduct/internal/webrender"
)

func TestPrerenderProductionFidelity(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	// example/internal/fidelity -> example
	exampleDir := filepath.Clean(filepath.Join(wd, "..", ".."))
	web := filepath.Join(exampleDir, "web")
	if _, err := os.Stat(filepath.Join(web, "node_modules")); err != nil {
		t.Skip("web/node_modules missing — run npm install at the repo root first")
	}

	aliases := webrender.AppendTanstackAliases(
		renderx.DefaultSSRAliases(web, filepath.Join(exampleDir, "..", "packages")), web)
	bundle, err := renderx.BuildSSRBundle(renderx.BuildOptions{
		EntryPoints:   []string{filepath.Join("src", "entry-server.tsx")},
		AbsWorkingDir: web,
		NodePaths:     []string{filepath.Join(web, "node_modules")},
		Alias:         aliases,
	})
	if err != nil {
		t.Fatalf("SSR bundle build: %v", err)
	}
	t.Logf("ssr bundle %d bytes", len(bundle))

	pool, err := renderx.NewEnginePool(bundle, renderx.PoolOptions{
		Prelude:       webrender.TanstackPrelude(),
		RenderTimeout: 30 * time.Second,
	})
	if err != nil {
		t.Fatalf("engine pool: %v", err)
	}
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	routes, err := pool.Routes(ctx)
	if err != nil {
		t.Fatalf("route table: %v", err)
	}
	if len(routes) < 10 {
		t.Fatalf("route table has %d routes, expected the full example app", len(routes))
	}

	// The home page is the exact page that died in the escape: TanStack router
	// creation runs rawParseSearch inside the sandbox at render time.
	res, err := pool.Render(ctx, "product", "/", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("home render (this is the escape class: SSR bundle + sandbox): %v", err)
	}
	if len(res.HTML) < 1000 {
		t.Fatalf("home rendered suspiciously little HTML (%d bytes)", len(res.HTML))
	}
	for _, want := range []string{"min-h-screen", "bg-card"} {
		if !strings.Contains(res.HTML, want) {
			t.Errorf("home HTML missing %q — the provider stack did not render", want)
		}
	}
	t.Logf("home render %d bytes", len(res.HTML))
}
