package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/platform/renderx"
	"myproduct/internal/blog"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if len(os.Args) < 2 || os.Args[1] != "prerender" {
		fmt.Fprintf(os.Stderr, "用法: %s prerender [--warm=/blog/:slug,...]\n", os.Args[0])
		os.Exit(2)
	}
	var warm []string
	for _, arg := range os.Args[2:] {
		const flag = "--warm="
		if !strings.HasPrefix(arg, flag) {
			fmt.Fprintf(os.Stderr, "未知参数 %q\n", arg)
			os.Exit(2)
		}
		for _, p := range strings.Split(strings.TrimPrefix(arg, flag), ",") {
			if p = strings.TrimSpace(p); p != "" {
				warm = append(warm, p)
			}
		}
	}

	wd, err := os.Getwd()
	if err != nil {
		log.Error("getwd", "err", err)
		os.Exit(1)
	}
	web := filepath.Join(wd, "web")

	nodeModules := filepath.Join(web, "node_modules")
	bundle, err := renderx.BuildSSRBundle(renderx.BuildOptions{
		EntryPoints:   []string{filepath.Join("src", "entry-server.tsx")},
		AbsWorkingDir: web,
		NodePaths:     []string{nodeModules},
		Alias:         renderx.DefaultSSRAliases(web, filepath.Join(wd, "..", "packages")),
	})
	if err != nil {
		log.Error("SSR bundle 构建", "err", err)
		os.Exit(1)
	}
	log.Info("ssr bundle", "bytes", len(bundle))

	manifestPath := filepath.Join(web, "dist", ".vite", "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		log.Error("读 vite manifest（先 cd web && npx vite build）", "path", manifestPath, "err", err)
		os.Exit(1)
	}
	assets, err := renderx.ParseViteManifest(manifestData, "")
	if err != nil {
		log.Error("vite manifest", "err", err)
		os.Exit(1)
	}
	buildID := renderx.ViteBuildID(manifestData)

	pool, err := renderx.NewEnginePool(bundle, renderx.PoolOptions{RenderTimeout: 10 * time.Second})
	if err != nil {
		log.Error("引擎池", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	routes, err := pool.Routes(ctx)
	if err != nil {
		log.Error("路由表询问", "err", err)
		os.Exit(1)
	}

	reg := renderx.NewRegistry()
	reg.RegisterPaths("/blog/:slug", func(ctx context.Context) ([]renderx.PagePath, error) {
		db, err := db(ctx)
		if err != nil {
			return nil, err
		}
		posts, err := blog.List(ctx, db)
		if err != nil {
			return nil, err
		}
		out := make([]renderx.PagePath, 0, len(posts))
		for _, p := range posts {
			out = append(out, renderx.PagePath{Params: renderx.Params{"slug": p.Slug}})
		}
		return out, nil
	})
	reg.RegisterLoader("/blog/:slug", func(ctx context.Context, p renderx.Params) (any, error) {
		db, err := db(ctx)
		if err != nil {
			return nil, err
		}
		post, found, err := blog.BySlug(ctx, db, p["slug"])
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, fmt.Errorf("blog: post %q not found", p["slug"])
		}
		return map[string]any{"post": post}, nil
	})
	if err := reg.Reconcile(routes); err != nil {
		log.Error("注册表对账（routes.tsx ↔ Go 注册键漂移）", "err", err)
		os.Exit(1)
	}

	outDir := filepath.Join(web, "dist", "prerender")
	manifest, err := renderx.Prerender(ctx, renderx.PrerenderDeps{
		Renderer:   pool,
		OutDir:     outDir,
		Routes:     routes,
		Warm:       warm,
		BuildID:    buildID,
		ViteAssets: assets,
		Lang:       "zh-CN",
		Registry:   reg,
	})
	if err != nil {
		log.Error("预渲染失败（G5：构建失败即发布失败）", "err", err)
		os.Exit(1)
	}

	if err := os.WriteFile(filepath.Join(web, "dist", "ssr-bundle.js"), bundle, 0o644); err != nil {
		log.Error("写 ssr-bundle.js", "err", err)
		os.Exit(1)
	}

	log.Info("prerender done", "pages", len(manifest.Pages), "buildId", buildID[:12]+"…")
	for _, p := range manifest.Pages {
		log.Info("  page", "path", p.Path, "pageId", p.PageID, "file", p.File)
	}

	// SEO 体检（visitor-walk A 批）：对本次预渲染产物逐页审计 title/description/
	// canonical（含重复 canonical 查重——SSR 路径不去重，一页一个 canonical 是
	// 产品侧规则，构建期点名）。title 缺失 = 构建失败（SEO 第一屏的核心信号）；
	// description/重复 canonical 缺失仅告警——它们是否必须取决于产品（G2 只钉 title）。
	// 运行期渲染页（--warm 未列入的 Loader 页）不在此列：它们没有构建期产物，
	// 上线前请用 --warm 预热一次做体检，或在产品侧加监控。
	auditSEO(log, outDir, manifest)
}

func auditSEO(log *slog.Logger, outDir string, manifest renderx.PrerenderManifest) {
	rep, err := auditSEOFiles(outDir, manifest)
	if err != nil {
		log.Error("SEO 体检读产物", "err", err)
		os.Exit(1)
	}
	for _, p := range rep.missingDesc {
		log.Warn("SEO 体检：缺 meta description", "path", p)
	}
	for _, p := range rep.missingCanonical {
		log.Warn("SEO 体检：缺 canonical", "path", p)
	}
	for _, p := range rep.duplicateCanonical {
		log.Warn("SEO 体检：重复 canonical（一页只应有一个；SSR head 不会去重）", "path", p)
	}
	if len(rep.missingTitle) > 0 {
		log.Error("SEO 体检：预渲染产物缺 <title>（useSEO 未调用？）", "pages", rep.missingTitle)
		os.Exit(1)
	}
	log.Info("SEO 体检通过", "pages", len(manifest.Pages),
		"missing_description", len(rep.missingDesc),
		"missing_canonical", len(rep.missingCanonical),
		"duplicate_canonical", len(rep.duplicateCanonical))
}

// seoReport 是体检的纯结果（auditSEO 负责日志与退出码）。
type seoReport struct {
	missingTitle       []string
	missingDesc        []string
	missingCanonical   []string
	duplicateCanonical []string
}

// auditSEOFiles 按 manifest 逐页读盘审计，汇总四类问题。
func auditSEOFiles(outDir string, manifest renderx.PrerenderManifest) (seoReport, error) {
	var rep seoReport
	for _, p := range manifest.Pages {
		data, err := os.ReadFile(filepath.Join(outDir, filepath.FromSlash(p.File)))
		if err != nil {
			return seoReport{}, fmt.Errorf("页面 %s（%s）: %w", p.Path, p.File, err)
		}
		sig := renderx.AuditSEO(data)
		if sig.Title == "" {
			rep.missingTitle = append(rep.missingTitle, p.Path)
		}
		if sig.Description == "" {
			rep.missingDesc = append(rep.missingDesc, p.Path)
		}
		if sig.Canonical == "" {
			rep.missingCanonical = append(rep.missingCanonical, p.Path)
		}
		if sig.CanonicalCount > 1 {
			rep.duplicateCanonical = append(rep.duplicateCanonical, p.Path)
		}
	}
	return rep, nil
}

var (
	dbOnce sync.Once
	dbPool *pgxpool.Pool
	dbErr  error
)

func db(ctx context.Context) (*pgxpool.Pool, error) {
	dbOnce.Do(func() {
		url := os.Getenv("DATABASE_URL")
		if url == "" {
			url = "postgres://pk:pk@localhost:5437/pk?sslmode=disable"
		}
		pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		p, err := pgxpool.New(pingCtx, url)
		if err == nil {
			err = p.Ping(pingCtx)
		}
		if err != nil {
			dbErr = fmt.Errorf("数据库连接（--warm 预热需要 DATABASE_URL）: %w", err)
			return
		}
		dbPool = p
	})
	return dbPool, dbErr
}
