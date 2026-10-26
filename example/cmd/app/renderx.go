package main

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/haozing/ploykit/platform/renderx"
	"github.com/haozing/ploykit/platform/storagex"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/jackc/pgx/v5/pgxpool"

	"myproduct/internal/blog"
)

// renderxHandler assembles the render pipeline and registers the SEO
// companion routes on mux. wrap (the traffic-counting middleware, nil =
// identity) is applied to the companions too so crawler fetches of them are
// counted.
//
// SEO companions across the three startup states:
//   - /robots.txt always serves (static config).
//   - /sitemap.xml serves when PUBLIC_BASE_URL holds a valid absolute origin
//     AND the render pipeline is enabled (the route table comes from the SSR
//     bundle). Both missing pieces are loudly logged, and robots.txt never
//     carries a Sitemap: line pointing at a route that is not mounted.
func renderxHandler(ctx context.Context, mux *webx.Mux, pool *pgxpool.Pool, cacheDir string, wrap func(http.Handler) http.Handler) (h http.Handler, eng *renderx.EnginePool, ok bool, err error) {
	if wrap == nil {
		wrap = func(h http.Handler) http.Handler { return h }
	}

	// PUBLIC_BASE_URL must be an absolute http(s) origin: anything else would
	// silently emit non-absolute <loc> values (a wrong origin in an SEO file
	// is worse than no file) — treat it as unset, with a warning.
	baseURL, baseWarn := validatedBaseURL(env("PUBLIC_BASE_URL", ""))
	if baseWarn != "" {
		slog.Warn(baseWarn)
	}

	mountRobots := func(sitemapURL string) {
		mux.Handle("/robots.txt", wrap(renderx.RobotsHandler(renderx.RobotsOptions{
			SitemapURL: sitemapURL,
			// 应用壳页（CSR 路由）只有空 root，抓了也是空页；API 与上传对象同理。
			Disallow: []string{"/api/", "/uploads/", "/app", "/account", "/settings", "/admin", "/dev/"},
		})))
	}

	renderx.RegisterPaths("/blog/:slug", func(ctx context.Context) ([]renderx.PagePath, error) {
		posts, err := blog.List(ctx, pool)
		if err != nil {
			return nil, err
		}
		out := make([]renderx.PagePath, 0, len(posts))
		for _, p := range posts {
			out = append(out, renderx.PagePath{Params: renderx.Params{"slug": p.Slug}})
		}
		return out, nil
	})
	renderx.RegisterLoader("/blog/:slug", func(ctx context.Context, p renderx.Params) (any, error) {
		post, found, err := blog.BySlug(ctx, pool, p["slug"])
		if err != nil {
			return nil, err
		}
		if !found {

			return nil, fmt.Errorf("blog: post %q: %w", p["slug"], renderx.ErrPageNotFound)
		}
		return map[string]any{"post": post}, nil
	})

	renderx.RegisterDep("/", "/blog/:slug")

	fe, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		return nil, nil, false, err
	}
	bundle, err := fs.ReadFile(fe, "ssr-bundle.js")
	if err != nil {
		// Degraded mode (no SSR bundle): the route table does not exist, so no
		// sitemap route is mounted — robots.txt still serves, but without the
		// Sitemap line (never point crawlers at an unmounted route).
		mountRobots("")
		slog.Warn("renderx 未启用：/sitemap.xml 未挂载（robots.txt 服务时不带 Sitemap 指针）")
		return nil, nil, false, nil
	}
	manifestData, err := fs.ReadFile(fe, filepath.ToSlash(filepath.Join(".vite", "manifest.json")))
	if err != nil {
		return nil, nil, false, fmt.Errorf("embed 缺 .vite/manifest.json（SSR 产物与客户端资产不配套）: %w", err)
	}
	assets, err := renderx.ParseViteManifest(manifestData, "")
	if err != nil {
		return nil, nil, false, err
	}
	buildID := renderx.ViteBuildID(manifestData)

	// 壳 head 继承 + og 绝对化基址（与 cmd/render 同一能力，随 ViteAssets
	// 生效）：运行时 SSR 文档继承壳的 favicon/theme-color/modulepreload 与
	// html/body 属性；PUBLIC_BASE_URL（已在上方校验）做相对 og:* 的绝对化。
	assets.Shell = shellHeadFromFS(fe)
	assets.BaseURL = baseURL

	// TanStack SSR（router-tanstack 迁移）：SSR bundle 需要 prelude 补编
	// （URLSearchParams / AbortController shim），由 renderx 提供（TS 常量
	// PRELUDE_SHIMS 的 Go 副本，platform/renderx 的测试守漂移）。
	eng, err = renderx.NewEnginePool(bundle, renderx.PoolOptions{Prelude: renderx.TanstackPrelude()})
	if err != nil {
		return nil, eng, false, fmt.Errorf("SSR bundle 求值: %w", err)
	}
	routes, err := eng.Routes(ctx)
	if err != nil {
		return nil, eng, false, fmt.Errorf("路由表询问: %w", err)
	}
	if err := renderx.Reconcile(routes); err != nil {
		return nil, eng, false, fmt.Errorf("注册表对账: %w", err)
	}

	if baseURL != "" {
		sitemapURL := baseURL + "/sitemap.xml"
		mountRobots(sitemapURL)
		mux.Handle("/sitemap.xml", wrap(renderx.SitemapHandler(routes, baseURL, renderx.SitemapOptions{})))
	} else {
		mountRobots("")
		slog.Warn("PUBLIC_BASE_URL 未设置或非法：/sitemap.xml 未挂载（robots.txt 仍服务）")
	}

	disk, err := storagex.NewLocal(cacheDir)
	if err != nil {
		return nil, eng, false, fmt.Errorf("缓存目录 %s: %w", cacheDir, err)
	}
	cache, err := renderx.NewLayeredCache(renderx.CacheConfig{BuildID: buildID, Disk: disk})
	if err != nil {
		return nil, eng, false, err
	}
	if err := cache.PurgeForeign(ctx, buildID); err != nil {
		return nil, eng, false, fmt.Errorf("清异代缓存: %w", err)
	}

	prerenderFS, err := fs.Sub(fe, "prerender")
	if err != nil {
		return nil, eng, false, err
	}

	h = renderx.Handler(renderx.HandlerDeps{
		PrerenderFS: prerenderFS,
		SPA:         frontendHandler(),
		Cache:       cache,
		Renderer:    eng,
		Routes:      routes,
		BuildID:     buildID,
		Assets:      assets,
		Lang:        "zh-CN",
		// 未知路径按 404 兜底（S-12）：只有 HTML 壳文档被降级为 404——
		// 人仍然拿到壳字节（客户端路由照常启动渲染），爬虫看到诚实的
		// 404 而非可收录的薄壳；SPA 处理器服务的真实静态文件（assets/
		// favicon）保持原状态码（2026-10-26 审计 P0 回归）。example 的
		// CSR 应用页（/app、/admin/* 等非内容页）深链以 404+壳 服务：
		// 渲染照常、不被收录，符合预期；静态内容页走 embed/cache/render
		// 层不受此策略影响。
		UnknownPath: renderx.UnknownPathNotFound,
	})
	return h, eng, true, nil
}

// shellHeadFromFS 从内嵌前端产物里解析 Vite 壳，供文档组装继承壳 head
// （favicon/theme-color/modulepreload）与 html/body 属性。缺 index.html
// （未构建的 checkout）降级为零值并告警——渲染照常，只是不继承。
func shellHeadFromFS(fe fs.FS) renderx.ShellHead {
	data, err := fs.ReadFile(fe, "index.html")
	if err != nil {
		slog.Warn("embed 缺 index.html：壳 head（favicon/theme-color/modulepreload）不继承")
		return renderx.ShellHead{}
	}
	return renderx.ParseShellHead(string(data))
}

// validatedBaseURL normalizes PUBLIC_BASE_URL into a usable origin: trailing
// slashes trimmed; empty input passes through as "" (unset); malformed input
// returns "" plus a warning string for the caller to log.
func validatedBaseURL(raw string) (string, string) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return "", ""
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Sprintf("PUBLIC_BASE_URL %q 不是绝对 http(s) origin（如 https://example.com），按未设置处理", raw)
	}
	return raw, ""
}
