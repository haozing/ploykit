package main

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:frontend
var frontendFS embed.FS

func frontendHandler() http.Handler {
	sub, _ := fs.Sub(frontendFS, "frontend")
	fileServer := http.FileServer(http.FS(sub))
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
