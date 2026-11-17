package renderx

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
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

func TestSitemapLastmod(t *testing.T) {
	updated := time.Date(2026, 10, 17, 9, 30, 0, 0, time.FixedZone("CST", 8*3600))
	reg := NewRegistry()
	reg.RegisterPaths("/blog/:slug", func(ctx context.Context) ([]PagePath, error) {
		return []PagePath{{Params: Params{"slug": "hello"}}, {Params: Params{"slug": "ghost"}}}, nil
	})
	h := SitemapHandler(seoTestRoutes(), "https://example.com", SitemapOptions{
		Registry: reg,
		Lastmod: func(_ context.Context, _ RouteSpec, location string, params Params) (time.Time, bool) {
			// /blog/:slug 按 params 查时间；未知的 ghost 报 false（该条退化为
			// 纯 loc）；其余路由不给（ok=false）。
			if location == "/blog/hello" {
				return updated, true
			}
			if location == "/blog/ghost" {
				return time.Time{}, false
			}
			return time.Time{}, false
		},
	})
	got := body(t, get(t, h, "/sitemap.xml"))
	want := `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/blog/ghost</loc></url>
  <url><loc>https://example.com/blog/hello</loc><lastmod>2026-10-17</lastmod></url>
  <url><loc>https://example.com/pricing</loc></url>
</urlset>
`
	if got != want {
		t.Errorf("sitemap lastmod golden 不符：\n--- got ---\n%s--- want ---\n%s", got, want)
	}

	// 零值时间即回调误报：同样按无 lastmod 处理（不输出 <lastmod>0001-01-01）。
	reg2 := NewRegistry()
	reg2.RegisterPaths("/blog/:slug", func(ctx context.Context) ([]PagePath, error) {
		return []PagePath{{Params: Params{"slug": "hello"}}}, nil
	})
	h2 := SitemapHandler(seoTestRoutes(), "https://example.com", SitemapOptions{
		Registry: reg2,
		Lastmod: func(_ context.Context, _ RouteSpec, location string, _ Params) (time.Time, bool) {
			if location == "/" {
				return time.Time{}, true
			}
			return time.Time{}, false
		},
	})
	got2 := body(t, get(t, h2, "/sitemap.xml"))
	if strings.Contains(got2, "lastmod") || !strings.Contains(got2, "<loc>https://example.com/</loc>") {
		t.Errorf("零值 lastmod 应按缺省处理: %s", got2)
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

func TestIndexNowKeyHandler(t *testing.T) {
	const key = "a1b2c3d4e5f6g7h8"
	h := IndexNowKeyHandler(key)

	resp := get(t, h, "/"+key+".txt")
	if ct := resp.Header.Get("Content-Type"); ct != "text/plain; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	if tier := resp.Header.Get(HeaderTier); tier != TierIndexNowKey {
		t.Errorf("tier = %q, want %q", tier, TierIndexNowKey)
	}
	if got := body(t, resp); got != key {
		t.Errorf("key 文件 body = %q, want %q", got, key)
	}

	head := do(t, h, http.MethodHead, "/"+key+".txt")
	if head.StatusCode != http.StatusOK {
		t.Errorf("HEAD = %d, want 200", head.StatusCode)
	}
	if got := body(t, head); got != "" {
		t.Errorf("HEAD 不应有 body, got %q", got)
	}

	if resp := do(t, h, http.MethodPost, "/"+key+".txt"); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d, want 405", resp.StatusCode)
		resp.Body.Close()
	} else {
		if allow := resp.Header.Get("Allow"); allow != "GET, HEAD" {
			t.Errorf("405 Allow = %q, want %q", allow, "GET, HEAD")
		}
		if tier := resp.Header.Get(HeaderTier); tier != TierIndexNowKey {
			t.Errorf("405 tier = %q, want %q", tier, TierIndexNowKey)
		}
		resp.Body.Close()
	}
}

func TestIndexNowKeyHandlerRejectsBadKey(t *testing.T) {
	mustPanicKey := func(name, key string) {
		t.Helper()
		defer func() {
			if recover() == nil {
				t.Errorf("%s 应 panic（构造期校验）", name)
			}
		}()
		IndexNowKeyHandler(key)
	}
	cases := []struct {
		name string
		key  string
	}{
		{"空串", ""},
		{"太短（7 字符）", "abc123-"},
		{"太长（129 字符）", strings.Repeat("a", 129)},
		{"含下划线", "a1b2c3d4_e5f6g7h"},
		{"含空格", "a1b2c3d4 e5f6g7h"},
		{"含点（会被当成路径分隔）", "a1b2c3d4.e5f6g7h"},
	}
	for _, tc := range cases {
		mustPanicKey(tc.name, tc.key)
	}

	// 边界内合法：8 字符下界、128 字符上界、大小写与连字符混用。
	IndexNowKeyHandler("a1B2c3D4")
	IndexNowKeyHandler(strings.Repeat("aA0-", 32))
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

func TestIndexNowChunksLargeSubmission(t *testing.T) {
	var mu sync.Mutex
	var batchLens []int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			URLList []string `json:"urlList"`
		}
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &payload)
		mu.Lock()
		batchLens = append(batchLens, len(payload.URLList))
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	urls := make([]string, indexNowMaxURLs+1)
	for i := range urls {
		urls[i] = fmt.Sprintf("https://example.com/page-%d", i)
	}
	if err := IndexNow(context.Background(), IndexNowDeps{Endpoint: srv.URL, Key: "k", Host: "example.com"}, urls); err != nil {
		t.Fatal(err)
	}
	if len(batchLens) != 2 {
		t.Fatalf("POST 批数 = %d, want 2（%d 条 URL）", len(batchLens), len(urls))
	}
	for i, n := range batchLens {
		if n > indexNowMaxURLs {
			t.Errorf("第 %d 批 %d 条，超过上限 %d", i+1, n, indexNowMaxURLs)
		}
	}
	if batchLens[0] != indexNowMaxURLs || batchLens[1] != 1 {
		t.Errorf("分批长度 = %v, want [%d 1]", batchLens, indexNowMaxURLs)
	}
}

func TestIndexNowBatchErrorCarriesBatchNumber(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) == 2 {
			http.Error(w, `{"error":"Rejected"}`, http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	urls := make([]string, indexNowMaxURLs+5)
	err := IndexNow(context.Background(), IndexNowDeps{Endpoint: srv.URL, Key: "k", Host: "h"}, urls)
	if err == nil {
		t.Fatal("第 2 批被拒应报错")
	}
	if !strings.Contains(err.Error(), "第 2 批") {
		t.Errorf("错误应带批次上下文: %v", err)
	}
	if hits.Load() != 2 {
		t.Errorf("失败后不应继续后续批次, POST = %d", hits.Load())
	}
}

func TestIndexNowReportsErrorBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusForbidden)
		// 多行 JSON：错误信息必须压成单行且保留诊断片段。
		_, _ = w.Write([]byte("{\n  \"error\": \"Key not valid\"\n}\n"))
	}))
	defer srv.Close()

	err := IndexNow(context.Background(), IndexNowDeps{Endpoint: srv.URL, Key: "k", Host: "h"}, []string{"https://example.com/"})
	if err == nil {
		t.Fatal("403 应报错")
	}
	msg := err.Error()
	if !strings.Contains(msg, "403") {
		t.Errorf("错误信息应含状态码: %v", msg)
	}
	if !strings.Contains(msg, "Key not valid") {
		t.Errorf("错误信息应含响应体片段: %v", msg)
	}
	if strings.Contains(msg, "\n") {
		t.Errorf("错误信息应压成单行: %q", msg)
	}
}
