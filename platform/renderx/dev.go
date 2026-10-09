package renderx

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type DevHandlerDeps struct {
	BuildOpts BuildOptions

	PoolOpts PoolOptions

	NewRenderer func(bundle []byte, opts PoolOptions) (Renderer, error)

	Cache *LayeredCache

	Routes []RouteSpec

	BuildID string

	Assets ViteAssets
	Lang   string

	SPA http.Handler

	Registry *Registry

	Interval time.Duration

	Warn func(format string, args ...any)
}

type DevHandler struct {
	h           http.Handler
	swap        *swapRenderer
	cache       *LayeredCache
	newRenderer func(bundle []byte, opts PoolOptions) (Renderer, error)
	buildOpts   BuildOptions
	warn        func(format string, args ...any)

	cancel    context.CancelFunc
	done      chan struct{}
	closeOnce sync.Once
}

var _ http.Handler = (*DevHandler)(nil)

func NewDevHandler(deps DevHandlerDeps) (*DevHandler, error) {
	newRenderer := deps.NewRenderer
	if newRenderer == nil {
		newRenderer = func(bundle []byte, opts PoolOptions) (Renderer, error) {
			return NewEnginePool(bundle, opts)
		}
	}
	warn := deps.Warn
	if warn == nil {
		warn = log.Printf
	}
	if deps.Interval <= 0 {
		deps.Interval = time.Second
	}
	cache := deps.Cache
	if cache == nil {
		buildID := deps.BuildID
		if buildID == "" {
			buildID = "dev-" + time.Now().Format("20060102T150405")
		}
		var err error
		if cache, err = NewLayeredCache(CacheConfig{BuildID: buildID}); err != nil {
			return nil, err
		}
	}

	bundle, err := BuildSSRBundle(deps.BuildOpts)
	if err != nil {
		return nil, fmt.Errorf("renderx: dev 初始 SSR 构建失败: %w", err)
	}
	r, err := newRenderer(bundle, deps.PoolOpts)
	if err != nil {
		return nil, fmt.Errorf("renderx: dev 引擎创建失败: %w", err)
	}
	swap := &swapRenderer{}
	swap.store(r)

	d := &DevHandler{
		swap:        swap,
		cache:       cache,
		newRenderer: newRenderer,
		buildOpts:   deps.BuildOpts,
		warn:        warn,
		done:        make(chan struct{}),
	}

	d.h = Handler(HandlerDeps{
		SPA:      deps.SPA,
		Cache:    cache,
		Renderer: swap,
		Routes:   deps.Routes,
		BuildID:  cache.buildID,
		Assets:   deps.Assets,
		Lang:     deps.Lang,
		Registry: deps.Registry,
	})
	d.startWatcher(deps)
	return d, nil
}

func (d *DevHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) { d.h.ServeHTTP(w, r) }

func (d *DevHandler) Close() {
	d.closeOnce.Do(func() {
		d.cancel()
		<-d.done
		if c, ok := d.swap.load().(interface{ Close() }); ok {
			c.Close()
		}
	})
}

func (d *DevHandler) startWatcher(deps DevHandlerDeps) {
	ctx, cancel := context.WithCancel(context.Background())
	d.cancel = cancel
	go func() {
		defer close(d.done)
		ticker := time.NewTicker(deps.Interval)
		defer ticker.Stop()
		prev := devFingerprint(d.buildOpts)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cur := devFingerprint(d.buildOpts)
				if cur == prev {
					continue
				}
				prev = cur
				d.rebuild(deps.PoolOpts)
			}
		}
	}()
}

func (d *DevHandler) rebuild(opts PoolOptions) {
	bundle, err := BuildSSRBundle(d.buildOpts)
	if err != nil {
		d.warn("renderx(dev): SSR 重建失败（保留旧引擎）: %v", err)
		return
	}
	r, err := d.newRenderer(bundle, opts)
	if err != nil {
		d.warn("renderx(dev): 引擎重建失败（保留旧引擎）: %v", err)
		return
	}
	old := d.swap.load()
	d.swap.store(r)

	d.cache.mem.clear()
	if c, ok := old.(interface{ Close() }); ok {
		go c.Close()
	}
	d.warn("renderx(dev): 源码变更，SSR 引擎已重建")
}

type swapRenderer struct {
	cur atomic.Pointer[rendererBox]
}

type rendererBox struct{ r Renderer }

var _ Renderer = (*swapRenderer)(nil)

func (s *swapRenderer) Routes(ctx context.Context) ([]RouteSpec, error) {
	return s.load().Routes(ctx)
}

func (s *swapRenderer) Render(ctx context.Context, pageID, location string, props json.RawMessage) (RenderResult, error) {
	return s.load().Render(ctx, pageID, location, props)
}

func (s *swapRenderer) store(r Renderer) { s.cur.Store(&rendererBox{r: r}) }
func (s *swapRenderer) load() Renderer   { return s.cur.Load().r }

func devFingerprint(opts BuildOptions) string {
	var b strings.Builder
	for _, e := range opts.EntryPoints {
		p := resolveFromWorkDir(opts.AbsWorkingDir, e)
		if fi, err := os.Stat(p); err == nil {
			fmt.Fprintf(&b, "%s:%d\n", p, fi.ModTime().UnixNano())
		} else {
			fmt.Fprintf(&b, "%s:missing\n", p)
		}
	}
	root := devWatchRoot(opts)
	if root == "" {
		return b.String()
	}
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p == root {
				return nil
			}
			name := d.Name()
			if name == "node_modules" || name == "dist" || name == ".git" || strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			if rel, rerr := filepath.Rel(root, p); rerr == nil && strings.Count(filepath.ToSlash(rel), "/") >= 3 {
				return fs.SkipDir
			}
			return nil
		}
		switch strings.ToLower(filepath.Ext(p)) {
		case ".js", ".jsx", ".ts", ".tsx", ".mjs", ".css", ".json":
		default:
			return nil
		}
		if fi, ierr := d.Info(); ierr == nil {
			fmt.Fprintf(&b, "%s:%d\n", p, fi.ModTime().UnixNano())
		}
		return nil
	})
	return b.String()
}

func devWatchRoot(opts BuildOptions) string {
	if opts.AbsWorkingDir != "" {
		return opts.AbsWorkingDir
	}
	if len(opts.EntryPoints) == 0 {
		return ""
	}
	abs, err := filepath.Abs(opts.EntryPoints[0])
	if err != nil {
		return ""
	}
	return filepath.Dir(abs)
}

func resolveFromWorkDir(workDir, entry string) string {
	if filepath.IsAbs(entry) {
		return entry
	}
	if workDir != "" {
		return filepath.Join(workDir, entry)
	}
	return entry
}
