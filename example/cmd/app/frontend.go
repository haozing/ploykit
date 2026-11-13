package main

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/haozing/ploykit/platform/renderx"
	"github.com/haozing/ploykit/platform/webx"
)

//go:embed all:frontend
var frontendFS embed.FS

// buildAssetFiles reads the build's own asset list out of the embedded manifest
// and hands it to webx.AssetCacheManifest.
//
// This is the authoritative answer to "which URLs never change", and it is
// preferable to webx.AssetCache's filename heuristic: that heuristic cannot be
// made exact (a hand-written `Some-Page-Banner.png` looks exactly like a hash,
// while the real hash `CYhS-pAS` does not), and a false positive pins a file the
// product expects to replace in place for a year.
//
// Returns nil when the manifest is missing or unparseable; the caller then falls
// back to the heuristic. Losing the list costs cache lifetime, never
// correctness, so it must not fail the process.
func buildAssetFiles(sub fs.FS) []string {
	data, err := fs.ReadFile(sub, path.Join(".vite", "manifest.json"))
	if err != nil {
		return nil
	}
	files, err := renderx.ViteManifestFiles(data)
	if err != nil {
		return nil
	}
	return files
}

// defaultCacheExtensions is the extension set webx.CachePrefixDefault backstops:
// the replaceable static types this dist ships that are NOT content-addressed
// (brand logos, favicon, fonts). Hashed files under /assets/ win their own
// immutable policy from AssetCacheManifest/AssetCache first — this layer only
// fills what they leave alone.
//
// Deliberately absent: html (HTMLNoCache owns revalidation), txt/xml
// (robots.txt/sitemap.xml must not go stale in a shared cache), and the
// internal ssr-bundle.js. A product serving unhashed CSS/JS should declare
// those through CachePrefixTTL with a TTL it is willing to wait out.
var defaultCacheExtensions = []string{
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
	".woff", ".woff2",
}

// defaultCacheTTL is deliberately a week, not immutable: these files can be
// replaced in place (/brand/logo-dark.png, /favicon.png), so a long TTL
// strands returning visitors on old bytes. A week collapses the measured
// failure (a 136KB favicon re-downloaded on every navigation) without making
// a logo swap wait a year to propagate.
const defaultCacheTTL = 7 * 24 * time.Hour

func frontendHandler() http.Handler {
	sub, _ := fs.Sub(frontendFS, "frontend")
	// Order matters, innermost first:
	//   FileServer → Precompressed → AssetCache → CachePrefixDefault
	// Precompressed must sit OUTSIDE FileServer (it answers with the .br body
	// instead of letting the file server stream the identity one) but INSIDE
	// the outer gzip layer, which skips bodies that already carry a
	// Content-Encoding. AssetCache only decorates headers, so its position
	// relative to Precompressed is free — keeping it outside means a 304 keeps
	// the immutable Cache-Control it set.
	//
	// AssetCache: the asset URLs listed in the build manifest may be cached
	// forever. Without it http.FileServer sends no cache headers at all and
	// every in-site navigation re-downloads the entry chunk (measured: the same
	// 178KB file fetched twice across one /login → /register navigation).
	// Manifest paths are exact; HTML and unhashed files are absent from it and
	// pass through untouched.
	assetFiles := buildAssetFiles(sub)
	cached := webx.Precompressed(sub)(http.FileServer(http.FS(sub)))
	if len(assetFiles) > 0 {
		cached = webx.AssetCacheManifest(cached, assetFiles)
	} else {
		// No manifest (hand-assembled dist): fall back to the filename
		// heuristic and accept its documented false positives.
		cached = webx.AssetCache(cached)
	}
	// CachePrefixDefault: the backstop for everything AssetCache leaves alone —
	// /brand/*.png and /favicon.png used to ship with zero cache headers, so a
	// returning visitor re-downloaded the whole brand directory (field report:
	// 358 KiB logo per navigation). Outside the AssetCache layer so an
	// extension match can never shadow the manifest's immutable policy.
	cached = webx.CachePrefixDefault(defaultCacheExtensions, defaultCacheTTL)(cached)
	fileServer := cached
	// HTMLNoCache: shells and any FileServer-served HTML revalidate (no-cache)
	// unless they declare their own policy. A release rotates hashed asset
	// URLs and deletes the old chunks; a heuristically cached pre-deploy shell
	// references assets that no longer exist and dies on the first dynamic
	// route import ("Failed to fetch dynamically imported module") until a
	// manual hard refresh. Wrapping HERE covers every mount of frontendHandler:
	// the direct mux fallback and the renderx SPA delegation point alike.
	return webx.HTMLNoCache(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/auth") ||
			strings.HasPrefix(p, "/webhook") || p == "/healthz" {
			http.NotFound(w, r)
			return
		}
		f, err := sub.Open(strings.TrimPrefix(p, "/"))
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		if strings.Contains(path.Base(p), ".") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		data, _ := fs.ReadFile(sub, "index.html")
		w.Write(data)
	}))
}
