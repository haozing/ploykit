package renderx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultCacheControl = "max-age=60, stale-while-revalidate=300"

	DefaultPoisonTTL = 10 * time.Minute

	poisonFileName = "_poison.json"
)

type HandlerDeps struct {
	PrerenderFS fs.FS

	SPA http.Handler

	Cache *LayeredCache

	Renderer Renderer

	Routes []RouteSpec

	BuildID string

	CacheControl string

	ErrorPage func(http.ResponseWriter, *http.Request, error)

	Warn func(format string, args ...any)

	Assets ViteAssets

	Lang string

	Registry *Registry

	PoisonTTL time.Duration
}

func Handler(deps HandlerDeps) http.Handler {
	if deps.Cache == nil {
		panic("renderx: HandlerDeps.Cache 不能为空")
	}
	if deps.Renderer == nil {
		panic("renderx: HandlerDeps.Renderer 不能为空")
	}
	if deps.BuildID == "" {
		panic("renderx: HandlerDeps.BuildID 不能为空")
	}
	if deps.CacheControl == "" {
		deps.CacheControl = DefaultCacheControl
	}
	if deps.ErrorPage == nil {
		deps.ErrorPage = defaultErrorPage
	}
	if deps.Warn == nil {
		deps.Warn = log.Printf
	}
	if deps.Registry == nil {
		deps.Registry = defaultRegistry
	}
	h := &handler{
		deps:          deps,
		statics:       staticRoutes(deps.Routes),
		manifestETags: readManifestETags(deps.PrerenderFS),
		poison:        newPoisonList(deps.Cache.diskRoot(), deps.PoisonTTL),
	}
	RegisterService(&Service{
		Cache:    deps.Cache,
		Renderer: deps.Renderer,
		Routes:   deps.Routes,
		BuildID:  deps.BuildID,
		Assets:   deps.Assets,
		Lang:     deps.Lang,
		Registry: deps.Registry,
		Warn:     deps.Warn,
	})
	return h
}

type handler struct {
	deps          HandlerDeps
	statics       []RouteSpec
	manifestETags map[string]string
	poison        *poisonList
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.spa(w, r)
		return
	}
	path := r.URL.Path

	if html, etag, ok := h.embedPage(path); ok {
		h.serveHTML(w, r, html, h.deps.CacheControl, etag)
		return
	}

	if rt, params, ok := matchStatic(h.statics, path); ok {
		h.serveStatic(w, r, path, rt, params)
		return
	}

	h.spa(w, r)
}

func (h *handler) serveStatic(w http.ResponseWriter, r *http.Request, path string, rt RouteSpec, params Params) {

	if h.poison.has(path) {
		h.deps.Warn("renderx: 毒页黑名单命中 %s（TTL 内不再触发渲染，R12）", path)
		h.serveStaleOrError(w, r, path, fmt.Errorf("renderx: 页面 %s 在毒页黑名单中", path))
		return
	}
	ent, err := h.deps.Cache.GetOrLoad(r.Context(), path, func(ctx context.Context) (CacheEntry, error) {
		props, perr := propsForRoute(ctx, h.deps.Registry, rt.Path, params)
		if perr != nil {
			return CacheEntry{}, fmt.Errorf("页面 %s（pageId=%s）取数失败: %w", path, rt.PageID, perr)
		}
		return renderPage(ctx, h.deps.Renderer, rt.PageID, path, props, h.deps.Lang, h.deps.Assets)
	})
	if err == nil {
		h.serveHTML(w, r, ent.HTML, h.deps.CacheControl, ent.PropsSHA256)
		return
	}

	if errors.Is(err, ErrPageNotFound) {
		h.serveNotFound(w, r)
		return
	}

	if errors.Is(err, ErrRenderTimeout) {
		h.poison.add(path)
		h.deps.Warn("renderx: 页面 %s 渲染超时，已入毒页黑名单（R12）: %v", path, err)
	}
	h.serveStaleOrError(w, r, path, err)
}

func (h *handler) serveNotFound(w http.ResponseWriter, r *http.Request) {
	if h.deps.SPA == nil {
		http.NotFound(w, r)
		return
	}
	h.deps.SPA.ServeHTTP(&notFoundWriter{ResponseWriter: w}, r)
}

type notFoundWriter struct {
	http.ResponseWriter
	wrote bool
}

func (w *notFoundWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	w.wrote = true
	w.ResponseWriter.WriteHeader(http.StatusNotFound)
}

func (w *notFoundWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusNotFound)
	}
	return w.ResponseWriter.Write(b)
}

func (h *handler) serveStaleOrError(w http.ResponseWriter, r *http.Request, path string, cause error) {
	if ent, ok := h.deps.Cache.GetStale(r.Context(), path); ok {
		h.deps.Warn("renderx: 页面 %s 渲染失败，发过期副本兜底（A6）: %v", path, cause)
		h.serveHTML(w, r, ent.HTML, "no-cache", ent.PropsSHA256)
		return
	}
	h.deps.ErrorPage(w, r, fmt.Errorf("页面 %s 渲染失败且无过期副本: %w", path, cause))
}

func (h *handler) embedPage(path string) (html []byte, etag string, ok bool) {
	if h.deps.PrerenderFS == nil {
		return nil, "", false
	}
	name, err := pageFilePath(path)
	if err != nil {
		return nil, "", false
	}
	data, err := fs.ReadFile(h.deps.PrerenderFS, name)
	if err != nil {
		return nil, "", false
	}
	etag = h.manifestETags[path]
	if etag == "" {
		sum := sha256.Sum256(data)
		etag = hex.EncodeToString(sum[:])
	}
	return data, etag, true
}

func (h *handler) buildScopedETag(fingerprint string) string {
	sum := sha256.Sum256([]byte(h.deps.BuildID + "\x00" + fingerprint))
	return hex.EncodeToString(sum[:])
}

func (h *handler) serveHTML(w http.ResponseWriter, r *http.Request, html []byte, cacheControl, etag string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", cacheControl)
	if etag != "" {
		etag = h.buildScopedETag(etag)
		quoted := `"` + etag + `"`
		w.Header().Set("ETag", quoted)
		if notModified(r, quoted) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(html)
}

func (h *handler) spa(w http.ResponseWriter, r *http.Request) {
	if h.deps.SPA == nil {
		http.NotFound(w, r)
		return
	}

	h.deps.SPA.ServeHTTP(w, r)
}

func staticRoutes(routes []RouteSpec) []RouteSpec {
	var out []RouteSpec
	for _, rt := range routes {
		if rt.Render == ModeStatic {
			out = append(out, rt)
		}
	}
	return out
}

func matchStatic(statics []RouteSpec, path string) (RouteSpec, Params, bool) {
	var fb RouteSpec
	var fbParams Params
	var fbScore int
	found := false
	for _, rt := range statics {
		if rt.Path == path {
			return rt, nil, true
		}
		params, ok := Match(rt.Path, path)
		if !ok || ValidateParams(params) != nil {
			continue
		}
		if score := patternScore(rt.Path); !found || score > fbScore {
			fb, fbParams, fbScore, found = rt, params, score, true
		}
	}
	return fb, fbParams, found
}

func patternScore(pattern string) int {
	score := 0
	for _, seg := range strings.Split(pattern, "/") {
		switch {
		case len(seg) > 1 && seg[0] == ':':
			score++
		case seg != "":
			score += 3
		}
	}
	return score
}

func notModified(r *http.Request, quotedETag string) bool {
	inm := r.Header.Get("If-None-Match")
	if inm == "" {
		return false
	}
	for _, cand := range strings.Split(inm, ",") {
		cand = strings.TrimPrefix(strings.TrimSpace(cand), "W/")
		if cand == quotedETag || cand == "*" {
			return true
		}
	}
	return false
}

func readManifestETags(fsys fs.FS) map[string]string {
	if fsys == nil {
		return nil
	}
	data, err := fs.ReadFile(fsys, manifestFileName)
	if err != nil {
		return nil
	}
	var m PrerenderManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	out := make(map[string]string, len(m.Pages))
	for _, p := range m.Pages {
		out[p.Path] = p.PropsSHA256
	}
	return out
}

func defaultErrorPage(w http.ResponseWriter, r *http.Request, err error) {
	http.Error(w, "页面渲染失败", http.StatusInternalServerError)
}

type poisonList struct {
	mu   sync.Mutex
	ttl  time.Duration
	file string
	exp  map[string]time.Time
}

func newPoisonList(diskRoot string, ttl time.Duration) *poisonList {
	if ttl <= 0 {
		ttl = DefaultPoisonTTL
	}
	p := &poisonList{ttl: ttl, exp: map[string]time.Time{}}
	if diskRoot != "" {
		p.file = filepath.Join(diskRoot, poisonFileName)
		p.load()
	}
	return p
}

func (p *poisonList) has(path string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	exp, ok := p.exp[path]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(p.exp, path)
		return false
	}
	return true
}

func (p *poisonList) add(path string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.exp[path] = time.Now().Add(p.ttl)
	p.persistLocked()
}

func (p *poisonList) load() {
	data, err := os.ReadFile(p.file)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &p.exp)
}

func (p *poisonList) persistLocked() {
	if p.file == "" {
		return
	}
	data, err := json.Marshal(p.exp)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p.file), 0o755)
	_ = os.WriteFile(p.file, data, 0o644)
}
