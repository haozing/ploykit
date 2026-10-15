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
	if tier := resp.Header.Get(HeaderTier); tier != TierSitemap {
		t.Errorf("tier = %q, want %q", tier, TierSitemap)
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
	} else {
		if allow := resp.Header.Get("Allow"); allow != "GET, HEAD" {
			t.Errorf("405 Allow = %q, want %q (RFC 9110)", allow, "GET, HEAD")
		}
		if tier := resp.Header.Get(HeaderTier); tier != TierSitemap {
			t.Errorf("405 tier = %q, want %q", tier, TierSitemap)
		}
		resp.Body.Close()
	}
}

func TestSitemapHandlerRejectsBadBaseURL(t *testing.T) {
	mustPanic := func(name string, fn func()) {
		t.Helper()
		defer func() {
			if recover() == nil {
				t.Errorf("%s 应 panic（构造期校验）", name)
			}
		}()
		fn()
	}
	routes := []RouteSpec{{Path: "/", PageID: "landing", Render: ModeStatic}}
	mustPanic("空 baseURL", func() { SitemapHandler(routes, "", SitemapOptions{}) })
	mustPanic("无 scheme", func() { SitemapHandler(routes, "example.com", SitemapOptions{}) })
	mustPanic("非 http(s)", func() { SitemapHandler(routes, "ftp://example.com", SitemapOptions{}) })
	mustPanic("带 query", func() { SitemapHandler(routes, "https://example.com?x=1", SitemapOptions{}) })

	// 合法值（含尾斜杠）不 panic
	h := SitemapHandler(routes, "https://example.com/", SitemapOptions{})
	if got := body(t, get(t, h, "/sitemap.xml")); !strings.Contains(got, "<loc>https://example.com/</loc>") {
		t.Errorf("尾斜杠 origin 应产出正确 loc: %s", got)
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

func TestRobotsHandler(t *testing.T) {
	h := RobotsHandler(RobotsOptions{
		SitemapURL: "https://example.com/sitemap.xml",
		Disallow:   []string{"/api/", "/admin"},
		Extra:      []string{"User-agent: BadBot", "Disallow: /"},
	})

	resp := get(t, h, "/robots.txt")
	if ct := resp.Header.Get("Content-Type"); ct != "text/plain; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	if tier := resp.Header.Get(HeaderTier); tier != TierRobots {
		t.Errorf("tier = %q, want %q", tier, TierRobots)
	}
	want := "User-agent: *\nDisallow: /api/\nDisallow: /admin\n\nUser-agent: BadBot\nDisallow: /\nSitemap: https://example.com/sitemap.xml\n"
	if got := body(t, resp); got != want {
		t.Errorf("robots golden 不符：\n--- got ---\n%s--- want ---\n%s", got, want)
	}

	if resp := do(t, h, http.MethodPost, "/robots.txt"); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /robots.txt = %d, want 405", resp.StatusCode)
		resp.Body.Close()
	}
}

func TestRobotsHandlerEmptyAndHead(t *testing.T) {
	h := RobotsHandler(RobotsOptions{})
	resp := get(t, h, "/robots.txt")
	if got := body(t, resp); got != "User-agent: *\n" {
		t.Errorf("空配置 robots = %q", got)
	}

	head := do(t, h, http.MethodHead, "/robots.txt")
	if head.StatusCode != http.StatusOK {
		t.Errorf("HEAD /robots.txt = %d", head.StatusCode)
	}
	if got := body(t, head); got != "" {
		t.Errorf("HEAD 不应有 body, got %q", got)
	}
}

func TestRobotsHandlerRejectsMalformedOptions(t *testing.T) {
	mustPanic := func(name string, fn func()) {
		t.Helper()
		defer func() {
			if recover() == nil {
				t.Errorf("%s 应 panic", name)
			}
		}()
		fn()
	}
	mustPanic("Disallow 不以 / 开头", func() { RobotsHandler(RobotsOptions{Disallow: []string{"api/"}}) })
	mustPanic("Disallow 含换行", func() { RobotsHandler(RobotsOptions{Disallow: []string{"/a\nDisallow: /"}}) })
	mustPanic("Disallow 含 #（解析器按注释截断）", func() { RobotsHandler(RobotsOptions{Disallow: []string{"/a#b"}}) })
	mustPanic("Extra 含换行", func() { RobotsHandler(RobotsOptions{Extra: []string{"Allow: /a\r\nDisallow: /"}}) })
	mustPanic("SitemapURL 含换行（行注入）", func() {
		RobotsHandler(RobotsOptions{SitemapURL: "https://x.com/sitemap.xml\nUser-agent: EvilBot\nDisallow: /"})
	})
	mustPanic("SitemapURL 相对值", func() { RobotsHandler(RobotsOptions{SitemapURL: "/sitemap.xml"}) })
	mustPanic("SitemapURL 非 http(s)", func() { RobotsHandler(RobotsOptions{SitemapURL: "ftp://x.com/sitemap.xml"}) })
}

func TestAuditSEO(t *testing.T) {
	doc := []byte(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>标题 &amp; 关键字</title>
  <meta name="description" content="描述 &lt;含实体&gt;">
  <link rel="canonical" href="https://example.com/blog/go-tips?a=1&amp;b=2">
  <link rel="stylesheet" href="/assets/x.css">
</head>
<body><div id="root"></div></body>
</html>
`)
	got := AuditSEO(doc)
	if got.Title != "标题 & 关键字" {
		t.Errorf("Title = %q", got.Title)
	}
	if got.Description != "描述 <含实体>" {
		t.Errorf("Description = %q", got.Description)
	}
	if got.Canonical != "https://example.com/blog/go-tips?a=1&b=2" {
		t.Errorf("Canonical = %q", got.Canonical)
	}

	// attribute order independence + missing signals
	reordered := []byte(`<head><link href="/rel-canvas" rel="canonical"><meta content="d" name="description"><title>t</title></head>`)
	if got := AuditSEO(reordered); got.Canonical != "/rel-canvas" || got.Description != "d" || got.Title != "t" {
		t.Errorf("乱序属性审计失败: %+v", got)
	}

	bare := []byte(`<html><head><meta charset="utf-8"></head><body></body></html>`)
	if got := AuditSEO(bare); got != (SEOSignals{}) {
		t.Errorf("缺失信号应全空: %+v", got)
	}

	// rel matching is case-insensitive; rel="stylesheet" is not canonical
	mixed := []byte(`<head><link rel="Canonical" href="/x"></head>`)
	if got := AuditSEO(mixed); got.Canonical != "/x" {
		t.Errorf("rel 大小写应容错: %+v", got)
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
