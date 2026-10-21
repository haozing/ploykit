package main

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"

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

func frontendHandler() http.Handler {
	sub, _ := fs.Sub(frontendFS, "frontend")
	// Order matters, innermost first:
	//   FileServer → AssetCache → Precompressed
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
	fileServer := cached
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})
}
