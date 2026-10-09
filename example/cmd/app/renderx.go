package main

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"path/filepath"

	"github.com/haozing/ploykit/platform/renderx"
	"github.com/haozing/ploykit/platform/storagex"
	"github.com/jackc/pgx/v5/pgxpool"

	"myproduct/internal/blog"
)

func renderxHandler(ctx context.Context, pool *pgxpool.Pool, cacheDir string) (h http.Handler, eng *renderx.EnginePool, ok bool, err error) {

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

	eng, err = renderx.NewEnginePool(bundle, renderx.PoolOptions{})
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
	})
	return h, eng, true, nil
}
