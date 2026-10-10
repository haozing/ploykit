package renderx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/errgroup"
)

var (
	ErrEmptyRenderOutput = errors.New("renderx: empty render output")

	ErrMissingTitle = errors.New("renderx: head directives emitted but no <title>")
)

const defaultPrerenderConcurrency = 4

type ViteAssets struct {
	CSS []string
	JS  []string
}

func (v ViteAssets) hydrateScript() string {
	if len(v.JS) == 0 {
		return ""
	}
	tags := make([]string, 0, len(v.JS))
	for _, js := range v.JS {
		tags = append(tags, `<script type="module" src="`+js+`"></script>`)
	}
	return strings.Join(tags, "\n  ")
}

// RenderOnce 把单个页面渲染成完整 HTML 文档——不经过缓存与 HTTP 层的
// 一次性渲染入口，预渲染 / handler 未命中 / 缓存回填共用此组装。
// 预览（草稿渲染）、邮件合成、调试等场景直接调用即可，语义与预渲染管线
// 完全一致（props 规范化、空输出校验、head 指令与 <title> 校验）。
func RenderOnce(ctx context.Context, r Renderer, pageID, location string, props json.RawMessage, lang string, assets ViteAssets) (CacheEntry, error) {
	propsJSON, err := normalizeProps(props)
	if err != nil {
		return CacheEntry{}, fmt.Errorf("页面 %s（pageId=%s）props 非法: %w", location, pageID, err)
	}
	res, err := r.Render(ctx, pageID, location, json.RawMessage(propsJSON))
	if err != nil {
		return CacheEntry{}, fmt.Errorf("页面 %s（pageId=%s）渲染失败: %w", location, pageID, err)
	}
	if strings.TrimSpace(res.HTML) == "" {
		return CacheEntry{}, fmt.Errorf("%w: 页面 %s（pageId=%s）", ErrEmptyRenderOutput, location, pageID)
	}
	var head []HeadEntry
	hasHeadDirective := false
	if res.Sink != nil {
		dirs := res.Sink.Directives()
		for _, d := range dirs {
			if d.Kind == "head" {
				hasHeadDirective = true
				break
			}
		}
		if head, err = HeadEntries(dirs); err != nil {
			return CacheEntry{}, fmt.Errorf("页面 %s（pageId=%s）指令解析失败: %w", location, pageID, err)
		}
	}
	doc, err := RenderDocument(Document{
		Lang:          lang,
		Head:          head,
		CSS:           assets.CSS,
		BodyHTML:      res.HTML,
		PropsJSON:     []byte(propsJSON),
		PageID:        pageID,
		HydrateScript: assets.hydrateScript(),
	})
	if err != nil {
		return CacheEntry{}, fmt.Errorf("页面 %s（pageId=%s）文档合成失败: %w", location, pageID, err)
	}

	if hasHeadDirective && !titleInHead(doc) {
		return CacheEntry{}, fmt.Errorf("%w: 页面 %s（pageId=%s）", ErrMissingTitle, location, pageID)
	}
	return CacheEntry{
		HTML:        doc,
		PropsSHA256: PropsSHA256([]byte(propsJSON)),
	}, nil
}

func titleInHead(doc []byte) bool {
	head := doc
	if i := bytes.Index(doc, []byte("</head>")); i >= 0 {
		head = doc[:i]
	}
	return bytes.Contains(head, []byte("<title>"))
}

func propsForRoute(ctx context.Context, reg *Registry, pattern string, params Params) (json.RawMessage, error) {
	fn, err := reg.LookupLoader(pattern)
	if err != nil {
		if errors.Is(err, ErrPatternNotFound) {
			return json.RawMessage("{}"), nil
		}
		return nil, err
	}
	v, err := fn(ctx, params)
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("renderx: Loader %q 返回值序列化失败: %w", pattern, err)
	}
	return b, nil
}

func pageFilePath(path string) (string, error) {
	key, err := cacheKey(path)
	if err != nil {
		return "", err
	}
	if key == "index.html" {
		return key, nil
	}
	return key + ".html", nil
}

const manifestFileName = "render-manifest.json"

type PrerenderManifestEntry struct {
	Path        string    `json:"path"`
	PageID      string    `json:"pageId"`
	PropsSHA256 string    `json:"propsSha256"`
	BuildID     string    `json:"buildId"`
	BuiltAt     time.Time `json:"builtAt"`
	File        string    `json:"file"`
}

type PrerenderManifest struct {
	BuildID     string                   `json:"buildId"`
	GeneratedAt time.Time                `json:"generatedAt"`
	Pages       []PrerenderManifestEntry `json:"pages"`
}

type PrerenderDeps struct {
	Renderer Renderer

	OutDir string

	Routes []RouteSpec

	Warm []string

	BuildID string

	ViteAssets ViteAssets

	Lang string

	Concurrency int

	Registry *Registry
}

type prerenderTask struct {
	route  RouteSpec
	params Params
}

func Prerender(ctx context.Context, deps PrerenderDeps) (PrerenderManifest, error) {
	if deps.Renderer == nil {
		return PrerenderManifest{}, errors.New("renderx: Prerender 需要 Renderer")
	}
	if deps.OutDir == "" {
		return PrerenderManifest{}, errors.New("renderx: Prerender 需要 OutDir")
	}
	if deps.BuildID == "" {
		return PrerenderManifest{}, errors.New("renderx: Prerender 需要 BuildID（manifest 逐页记录，A4）")
	}
	reg := deps.Registry
	if reg == nil {
		reg = defaultRegistry
	}

	if err := os.RemoveAll(deps.OutDir); err != nil {
		return PrerenderManifest{}, fmt.Errorf("renderx: 清空预渲染目录 %s 失败: %w", deps.OutDir, err)
	}
	if err := os.MkdirAll(deps.OutDir, 0o755); err != nil {
		return PrerenderManifest{}, fmt.Errorf("renderx: 创建预渲染目录 %s 失败: %w", deps.OutDir, err)
	}

	tasks, err := collectPrerenderTasks(ctx, deps, reg)
	if err != nil {
		return PrerenderManifest{}, err
	}

	limit := deps.Concurrency
	if limit <= 0 {
		limit = defaultPrerenderConcurrency
	}
	g, gctx := errgroup.WithContext(ctx)
	sem := make(chan struct{}, limit)
	var timeoutErr atomic.Value
	var mu sync.Mutex
	entries := make([]PrerenderManifestEntry, 0, len(tasks))

dispatch:
	for _, t := range tasks {
		select {
		case sem <- struct{}{}:
		case <-gctx.Done():
			break dispatch
		}
		t := t
		g.Go(func() error {
			defer func() { <-sem }()
			if gctx.Err() != nil {
				return nil
			}
			entry, err := renderPrerenderTask(gctx, deps, reg, t)
			if err != nil {
				if errors.Is(err, ErrRenderTimeout) {
					timeoutErr.Store(err)
					return err
				}
				return err
			}
			mu.Lock()
			entries = append(entries, entry)
			mu.Unlock()
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		if te, ok := timeoutErr.Load().(error); ok && te != nil && !errors.Is(err, te) {

			return PrerenderManifest{}, errors.Join(te, err)
		}
		return PrerenderManifest{}, err
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	manifest := PrerenderManifest{BuildID: deps.BuildID, GeneratedAt: time.Now().UTC(), Pages: entries}
	mb, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return PrerenderManifest{}, err
	}
	if err := os.WriteFile(filepath.Join(deps.OutDir, manifestFileName), append(mb, '\n'), 0o644); err != nil {
		return PrerenderManifest{}, fmt.Errorf("renderx: 写 %s 失败: %w", manifestFileName, err)
	}
	return manifest, nil
}

func collectPrerenderTasks(ctx context.Context, deps PrerenderDeps, reg *Registry) ([]prerenderTask, error) {
	warm := make(map[string]bool, len(deps.Warm))
	for _, p := range deps.Warm {
		warm[p] = true
	}
	var tasks []prerenderTask
	for _, rt := range deps.Routes {
		if rt.Render != ModeStatic {
			continue
		}
		_, lerr := reg.LookupLoader(rt.Path)
		hasLoader := lerr == nil
		if hasLoader && !warm[rt.Path] {
			continue
		}
		if !hasParams(rt.Path) {
			tasks = append(tasks, prerenderTask{route: rt})
			continue
		}
		pathsFn, err := reg.LookupPaths(rt.Path)
		if err != nil {
			return nil, fmt.Errorf("%w: 路由 %q（pageId=%s）预渲染需要 Paths 枚举器", ErrMissingPaths, rt.Path, rt.PageID)
		}
		instances, err := pathsFn(ctx)
		if err != nil {
			return nil, fmt.Errorf("renderx: 路由 %q Paths 枚举失败: %w", rt.Path, err)
		}
		for _, pp := range instances {
			if err := ValidateParams(pp.Params); err != nil {
				return nil, fmt.Errorf("路由 %q 枚举出非法参数实例: %w", rt.Path, err)
			}
			tasks = append(tasks, prerenderTask{route: rt, params: pp.Params})
		}
	}
	return tasks, nil
}

func renderPrerenderTask(ctx context.Context, deps PrerenderDeps, reg *Registry, t prerenderTask) (PrerenderManifestEntry, error) {
	location, ok := ExpandPath(t.route.Path, t.params)
	if !ok {
		return PrerenderManifestEntry{}, fmt.Errorf("renderx: 路由 %q 参数实例化失败: %v", t.route.Path, t.params)
	}
	props, err := propsForRoute(ctx, reg, t.route.Path, t.params)
	if err != nil {
		return PrerenderManifestEntry{}, fmt.Errorf("页面 %s（pageId=%s）取数失败: %w", location, t.route.PageID, err)
	}
	ent, err := RenderOnce(ctx, deps.Renderer, t.route.PageID, location, props, deps.Lang, deps.ViteAssets)
	if err != nil {
		return PrerenderManifestEntry{}, err
	}
	file, err := pageFilePath(location)
	if err != nil {
		return PrerenderManifestEntry{}, fmt.Errorf("页面 %s: %w", location, err)
	}
	if err := writePrerenderFile(deps.OutDir, file, ent.HTML); err != nil {
		return PrerenderManifestEntry{}, fmt.Errorf("页面 %s 写盘失败: %w", location, err)
	}
	return PrerenderManifestEntry{
		Path:        location,
		PageID:      t.route.PageID,
		PropsSHA256: ent.PropsSHA256,
		BuildID:     deps.BuildID,
		BuiltAt:     time.Now().UTC(),
		File:        file,
	}, nil
}

func writePrerenderFile(outDir, name string, html []byte) error {
	p := filepath.Join(outDir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, html, 0o644)
}
