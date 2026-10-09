package renderx

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func seoTestRoutes() []RouteSpec {
	return []RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/pricing", PageID: "pricing", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
		{Path: "/app", PageID: "dashboard", Render: ModeCSR},
	}
}

func TestSitemapGolden(t *testing.T) {
	reg := NewRegistry()
	reg.RegisterPaths("/blog/:slug", func(ctx context.Context) ([]PagePath, error) {
		return []PagePath{{Params: Params{"slug": "hello"}}, {Params: Params{"slug": "world"}}}, nil
	})
	h := SitemapHandler(seoTestRoutes(), "https://example.com", SitemapOptions{
		Registry: reg,
		Filter: func(route RouteSpec, location string, params Params) bool {
			return location != "/blog/world"
		},
	})

	resp := get(t, h, "/sitemap.xml")
	if ct := resp.Header.Get("Content-Type"); ct != "application/xml; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	got := body(t, resp)
	want := `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/blog/hello</loc></url>
  <url><loc>https://example.com/pricing</loc></url>
</urlset>
`
	if got != want {
		t.Errorf("sitemap golden 不符：\n--- got ---\n%s--- want ---\n%s", got, want)
	}

	if resp := do(t, h, http.MethodPost, "/sitemap.xml"); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /sitemap.xml = %d, want 405", resp.StatusCode)
		resp.Body.Close()
	}
}

func TestSitemapMissingPathsAndNoFilter(t *testing.T) {

	h := SitemapHandler([]RouteSpec{{Path: "/tag/:name", PageID: "tag", Render: ModeStatic}}, "https://x.com", SitemapOptions{})
	resp := get(t, h, "/sitemap.xml")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("缺 Paths 应 500, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	reg := NewRegistry()
	reg.RegisterPaths("/tag/:name", func(ctx context.Context) ([]PagePath, error) {
		return []PagePath{{Params: Params{"name": "go"}}}, nil
	})
	h2 := SitemapHandler([]RouteSpec{{Path: "/tag/:name", PageID: "tag", Render: ModeStatic}}, "https://x.com", SitemapOptions{Registry: reg})
	got := body(t, get(t, h2, "/sitemap.xml"))
	if !strings.Contains(got, "<loc>https://x.com/tag/go</loc>") {
		t.Errorf("无 Filter 应全收: %s", got)
	}
}

func TestIndexNow(t *testing.T) {
	var hits atomic.Int32
	var captured struct {
		Host    string   `json:"host"`
		Key     string   `json:"key"`
		URLList []string `json:"urlList"`
	}
	var contentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		contentType = r.Header.Get("Content-Type")
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &captured)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	urls := []string{"https://example.com/blog/hello", "https://example.com/"}
	if err := IndexNow(context.Background(), IndexNowDeps{Endpoint: srv.URL, Key: "a1b2c3", Host: "example.com"}, urls); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 1 {
		t.Fatalf("推送次数 = %d, want 1", hits.Load())
	}
	if captured.Host != "example.com" || captured.Key != "a1b2c3" || len(captured.URLList) != 2 || captured.URLList[0] != urls[0] {
		t.Errorf("POST body 不符: %+v", captured)
	}
	if !strings.HasPrefix(contentType, "application/json") {
		t.Errorf("Content-Type = %q", contentType)
	}

	if err := IndexNow(context.Background(), IndexNowDeps{Endpoint: srv.URL, Key: "k", Host: "h"}, nil); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 1 {
		t.Error("空列表不应发请求")
	}

	if err := IndexNow(context.Background(), IndexNowDeps{Endpoint: srv.URL}, urls); err == nil {
		t.Error("缺 Key/Host 应报错")
	}

	reject := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	defer reject.Close()
	err := IndexNow(context.Background(), IndexNowDeps{Endpoint: reject.URL, Key: "k", Host: "h"}, urls)
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Errorf("非 2xx 应报错且含状态码, got %v", err)
	}
}
