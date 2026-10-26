package renderx

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

// HeaderTier names the response header carrying which serving layer produced
// the response — one of the Tier* values below. It exists for traffic
// observation (metrics.TrafficConfig consumes it: "did the crawler get cache
// or SSR?") and for debugging ("why was this request rendered?"). Readers must
// keep in mind that a CDN caching the HTML replays the header of the origin
// response that first populated the cache.
const HeaderTier = "X-Renderx-Tier"

// Tier values, most-specific-first in the serving order: embedded prerender
// artifact, layered-cache hit, on-the-spot render (miss path), stale copy on
// render failure, SPA shell fallback (index.html routes incl. the 404 form),
// static asset passthrough, product error page. The SEO companions carry their
// own values so traffic middleware can count crawler fetches of them.
const (
	TierEmbed   = "embed"
	TierCache   = "cache"
	TierRender  = "render"
	TierStale   = "stale"
	TierSPA     = "spa"
	TierAsset   = "asset"
	TierError   = "error"
	TierRobots  = "robots"
	TierSitemap = "sitemap"
)

// UnknownPathPolicy selects what the handler does with a GET/HEAD path that
// matched no static route and hit no embedded prerender snapshot — the SPA
// fallback decision at the bottom of ServeHTTP.
type UnknownPathPolicy string

const (
	// UnknownPathSPAShell serves the SPA shell with status 200 — the v0.15.0
	// behavior and still the zero-value default, so existing deployments keep
	// serving their CSR routes (e.g. /login) without touching wiring.
	//
	// NOTE: this default is kept for compatibility only, and new deployments
	// are recommended to migrate to UnknownPathNotFound. SPA-fallback-200
	// turns every garbage URL (/random-page, /zh/fake, trailing-slash twins)
	// into an indexable soft-404 — the shell has no canonical, no noindex and
	// a generic title, and crawlers collect them (field report:
	// braceletmakeronline.com, GSC exposure on shell URLs). Products that
	// need a real 200 on specific CSR paths (they are app pages, not content)
	// should mount those paths ahead of renderx — registering them as ModeCSR
	// in the route table does NOT create a serving exemption (ModeCSR is
	// projection metadata: sitemap excludes non-static routes either way);
	// every non-static path flows through this policy.
	UnknownPathSPAShell UnknownPathPolicy = "spa-shell"

	// UnknownPathNotFound downgrades the SPA shell DOCUMENT to 404 via
	// notFoundWriter: human visitors still get the shell bytes (their client
	// router boots and renders the route) and crawlers see an honest 404
	// instead of an indexable thin shell. Static files the SPA handler
	// serves for real (assets, favicon) keep their genuine statuses — only
	// the HTML shell document is downgraded (audit P0 2026-10-26: an
	// earlier draft 404'd assets too, killing hydration site-wide).
	UnknownPathNotFound UnknownPathPolicy = "not-found"
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

	// UnknownPath selects the unmatched-path policy (see UnknownPathPolicy).
	// Zero value keeps the v0.15.0 behavior: SPA shell with 200.
	UnknownPath UnknownPathPolicy

	// ShellMeta is injected into the <head> of every SPA shell response —
	// both the plain fallback (spa) and its notFoundWriter-wrapped 404 form.
	// The typical use is declaring the shell pages "not indexable" once for
	// the whole site:
	//
	//	ShellMeta: []renderx.HeadEntry{{
	//	    Tag:   "meta",
	//	    Attrs: map[string]string{"name": "robots", "content": "noindex, follow"},
	//	}},
	//
	// Entries go through the same whitelist as renderer head directives
	// (renderHeadEntry: tag/attr name rules, deny script/iframe/base,
	// deny http-equiv) and a malformed entry panics at Handler construction.
	// Full-document responses (embed/cache/render tiers) never get ShellMeta —
	// they carry their own head.
	ShellMeta []HeadEntry
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
	switch deps.UnknownPath {
	case "", UnknownPathSPAShell, UnknownPathNotFound:
	default:
		panic(fmt.Sprintf("renderx: HandlerDeps.UnknownPath 未知取值 %q（可用：%s / %s，空串=v0.15.0 默认 SPA 壳）",
			deps.UnknownPath, UnknownPathSPAShell, UnknownPathNotFound))
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
	shellMeta := renderShellMeta(deps.ShellMeta)
	// embedDead is shared with the registered Service so Invalidate can punch
	// through to the embedded prerender layer (go:embed FS is read-only; the
	// tombstone set is the only way to "delete" from it until the next build).
	embedDead := newEmbedTombstone()
	h := &handler{
		deps:          deps,
		statics:       staticRoutes(deps.Routes),
		manifestETags: readManifestETags(deps.PrerenderFS),
		poison:        newPoisonList(deps.Cache.diskRoot(), deps.PoisonTTL),
		embedDead:     embedDead,
		shellMeta:     shellMeta,
	}
	RegisterService(&Service{
		Cache:     deps.Cache,
		Renderer:  deps.Renderer,
		Routes:    deps.Routes,
		BuildID:   deps.BuildID,
		Assets:    deps.Assets,
		Lang:      deps.Lang,
		Registry:  deps.Registry,
		Warn:      deps.Warn,
		embedDead: embedDead,
	})
	return h
}

type handler struct {
	deps          HandlerDeps
	statics       []RouteSpec
	manifestETags map[string]string
	poison        *poisonList
	embedDead     *embedTombstone
	shellMeta     string
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.spa(w, r)
		return
	}
	path := r.URL.Path

	// Trailing-slash normalization for page paths: /calculator/ would miss
	// every layer (embed's cacheKey, matchStatic patterns — both forbid
	// trailing slashes) and fall through to the SPA shell as a thin 200 twin
	// of the real page. Redirect to the canonical slash-less form first
	// (GET/HEAD only — the method gate above already routed the rest).
	if target, ok := trailingSlashRedirect(path, r.URL.RawQuery); ok {
		http.Redirect(w, r, target, http.StatusMovedPermanently)
		return
	}

	if html, etag, ok := h.embedPage(path); ok {
		h.serveHTML(w, r, html, h.deps.CacheControl, etag, TierEmbed)
		return
	}

	if rt, params, ok := matchStatic(h.statics, path); ok {
		h.serveStatic(w, r, path, rt, params)
		return
	}

	if h.deps.UnknownPath == UnknownPathNotFound {
		h.serveNotFound(w, r)
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
	ent, hit, err := h.deps.Cache.GetOrLoadHit(r.Context(), path, func(ctx context.Context) (CacheEntry, error) {
		props, perr := propsForRoute(ctx, h.deps.Registry, rt.Path, params)
		if perr != nil {
			return CacheEntry{}, fmt.Errorf("页面 %s（pageId=%s）取数失败: %w", path, rt.PageID, perr)
		}
		return RenderOnce(ctx, h.deps.Renderer, rt.PageID, path, props, h.deps.Lang, h.deps.Assets, rt.Hydrate)
	})
	if err == nil {
		tier := TierRender
		if hit {
			tier = TierCache
		}
		h.serveHTML(w, r, ent.HTML, h.deps.CacheControl, ent.PropsSHA256, tier)
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
	w.Header().Set(HeaderTier, TierSPA)
	if h.deps.SPA == nil {
		http.NotFound(w, r)
		return
	}
	// 404 semantics for the shell DOCUMENT only: notFoundWriter sits between
	// the shell-meta injector and the real writer, so injected meta still
	// flows through its Write. Only the HTML shell is downgraded to 404 —
	// the SPA handler also serves real static files (assets, favicon), and
	// those keep their genuine 200 (audit P0 2026-10-26: forcing 404 on
	// /assets/*.js broke hydration and styling for every page).
	h.serveSPA(&notFoundWriter{ResponseWriter: w}, r)
}

// notFoundWriter downgrades an HTML shell response to 404 while passing
// every other response (static files: 200 js/css/images, redirects, real
// errors) through with its original status. The decision gates on
// Content-Type at the first status/body write — mirroring shellMetaWriter's
// htmlShellCandidate — because handlers set the header before writing; when
// no type is declared yet, the first body bytes are sniffed.
type notFoundWriter struct {
	http.ResponseWriter
	wrote  bool
	pended int // status recorded by WriteHeader, emitted at first Write
}

func (w *notFoundWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	// Body-less statuses (redirects, 304) never reach Write: only an
	// untyped 200 — the shell case, decided by sniffing the first body
	// bytes — can afford to defer; everything else emits now.
	if ct := w.Header().Get("Content-Type"); ct != "" || code != http.StatusOK {
		w.wrote = true
		if ct != "" && htmlShellCandidate(w.Header()) {
			w.ResponseWriter.WriteHeader(http.StatusNotFound)
		} else {
			w.ResponseWriter.WriteHeader(code)
		}
		return
	}
	w.pended = code
}

func (w *notFoundWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		if w.Header().Get("Content-Type") == "" {
			// No declared type: sniff the first bytes the way net/http would,
			// so an untyped HTML shell still downgrades.
			if strings.Contains(http.DetectContentType(b[:min(len(b), 512)]), "text/html") {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
			}
		}
		code := w.pended
		if code == 0 {
			code = http.StatusOK
		}
		w.wrote = true
		if htmlShellCandidate(w.Header()) {
			w.ResponseWriter.WriteHeader(http.StatusNotFound)
		} else {
			w.ResponseWriter.WriteHeader(code)
		}
	}
	return w.ResponseWriter.Write(b)
}

func (h *handler) serveStaleOrError(w http.ResponseWriter, r *http.Request, path string, cause error) {
	if ent, ok := h.deps.Cache.GetStale(r.Context(), path); ok {
		h.deps.Warn("renderx: 页面 %s 渲染失败，发过期副本兜底（A6）: %v", path, cause)
		h.serveHTML(w, r, ent.HTML, "no-cache", ent.PropsSHA256, TierStale)
		return
	}
	h.deps.Warn("renderx: 页面 %s 渲染失败且无过期副本: %v", path, cause)
	w.Header().Set(HeaderTier, TierError)
	h.deps.ErrorPage(w, r, fmt.Errorf("页面 %s 渲染失败且无过期副本: %w", path, cause))
}

func (h *handler) embedPage(path string) (html []byte, etag string, ok bool) {
	if h.deps.PrerenderFS == nil {
		return nil, "", false
	}
	// Runtime invalidation punched through to the embed layer: a tombstoned
	// path serves as a miss and falls through to cache/render, whose Delete
	// Invalidate already performed. Without this check a deleted resource kept
	// serving its embedded snapshot until the next build (zombie page,
	// X-Renderx-Tier: embed).
	if h.embedDead.has(path) {
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

func (h *handler) serveHTML(w http.ResponseWriter, r *http.Request, html []byte, cacheControl, etag, tier string) {
	w.Header().Set(HeaderTier, tier)
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
	w.Header().Set(HeaderTier, spaTier(r.URL.Path))
	if h.deps.SPA == nil {
		http.NotFound(w, r)
		return
	}
	h.serveSPA(w, r)
}

// serveSPA runs the product's SPA handler on w (either the plain shell writer
// or its notFoundWriter-wrapped variant) and drains the shell-meta injector
// afterwards — a shell that never emitted </head> gets its fallback-ladder
// insertion here.
func (h *handler) serveSPA(w http.ResponseWriter, r *http.Request) {
	sw := h.shellWriter(w)
	h.deps.SPA.ServeHTTP(sw, r)
	if inj, ok := sw.(*shellMetaWriter); ok {
		inj.finish()
	}
}

// shellWriter wraps the response writer with ShellMeta injection when the
// handler was configured with ShellMeta; otherwise it returns w untouched so
// the shell bytes (and the 404-wrapped variant) are exactly what deps.SPA
// produced.
func (h *handler) shellWriter(w http.ResponseWriter) http.ResponseWriter {
	if h.shellMeta == "" {
		return w
	}
	return newShellMetaWriter(w, h.shellMeta)
}

// renderShellMeta validates and serializes the ShellMeta entries once at
// construction, applying the same whitelist the head-directive channel uses
// (renderHeadEntry). A malformed entry is a wiring error and panics here —
// same "malformed options explode at construction" contract as
// RobotsHandler/SitemapHandler.
func renderShellMeta(entries []HeadEntry) string {
	if len(entries) == 0 {
		return ""
	}
	parts := make([]string, 0, len(entries))
	for _, e := range entries {
		s, err := renderHeadEntry(e)
		if err != nil {
			panic(fmt.Sprintf("renderx: HandlerDeps.ShellMeta 非法条目 tag=%q: %v", e.Tag, err))
		}
		parts = append(parts, s)
	}
	return "\n  " + strings.Join(parts, "\n  ")
}

// shellMetaScanLimit caps how much of a shell response shellMetaWriter buffers
// while looking for the insertion point. Real SPA shells are kilobytes; a
// "shell" response still streaming after this much HTML with no </head> is
// passed through unmodified rather than buffered indefinitely.
const shellMetaScanLimit = 256 << 10

var headCloseTag = []byte("</head>")

// shellMetaWriter injects prepared meta tags into an HTML response produced by
// the product's SPA handler, whose bytes the framework does not control. It is
// deliberately narrow:
//
//   - Only responses that declare a text/html Content-Type and no
//     Content-Encoding are touched; everything else (JS/CSS/assets, a
//     self-compressed handler's byte stream) passes through byte-identical.
//   - Injection happens right before </head> (case-insensitive). Until that
//     point bytes are buffered (bounded by shellMetaScanLimit); once inserted
//     the writer streams through with zero copies.
//   - A shell with no </head> gets the fallback ladder in finish: after the
//     <head>/<html>/<!doctype> opener, in that order; a response matching none
//     of those shapes is flushed unmodified (never corrupt a body we do not
//     understand).
type shellMetaWriter struct {
	http.ResponseWriter
	inject   []byte
	buf      []byte
	scanning bool
	started  bool
	skip     bool
}

func newShellMetaWriter(w http.ResponseWriter, inject string) *shellMetaWriter {
	return &shellMetaWriter{ResponseWriter: w, inject: []byte(inject), scanning: true}
}

func (m *shellMetaWriter) Write(p []byte) (int, error) {
	if !m.started {
		m.started = true
		m.skip = !htmlShellCandidate(m.Header())
	}
	if m.skip || !m.scanning {
		return m.ResponseWriter.Write(p)
	}
	m.buf = append(m.buf, p...)
	if i := indexFold(m.buf, headCloseTag); i >= 0 {
		if err := m.emit(i); err != nil {
			return 0, err
		}
		return len(p), nil
	}
	if len(m.buf) > shellMetaScanLimit {
		// No </head> in a quarter megabyte of HTML: give up on injection,
		// stream the buffered bytes and everything after unchanged.
		if err := m.emitPassthrough(); err != nil {
			return 0, err
		}
		return len(p), nil
	}
	return len(p), nil
}

// emit writes the buffered bytes with the meta injected before offset split
// (the </head> match) and switches the writer to passthrough. The buffer is
// released so finish() knows insertion already happened.
func (m *shellMetaWriter) emit(split int) error {
	buf := m.buf
	m.buf = nil
	m.scanning = false
	if err := flush(m.ResponseWriter, buf[:split]); err != nil {
		return err
	}
	if err := flush(m.ResponseWriter, m.inject); err != nil {
		return err
	}
	return flush(m.ResponseWriter, buf[split:])
}

func (m *shellMetaWriter) emitPassthrough() error {
	buf := m.buf
	m.buf = nil
	m.scanning = false
	return flush(m.ResponseWriter, buf)
}

// finish flushes whatever is still buffered when the SPA handler returns —
// either the tail of a scan that never saw </head> (fallback ladder) or
// nothing (passthrough/skip modes).
func (m *shellMetaWriter) finish() {
	if !m.scanning || m.skip || len(m.buf) == 0 {
		return
	}
	for _, opener := range [...][]byte{[]byte("<head"), []byte("<html"), []byte("<!doctype")} {
		i := indexFold(m.buf, opener)
		if i < 0 {
			continue
		}
		if end := bytes.IndexByte(m.buf[i:], '>'); end >= 0 {
			at := i + end + 1
			buf := m.buf
			m.buf = nil
			m.scanning = false
			_ = flush(m.ResponseWriter, buf[:at])
			_ = flush(m.ResponseWriter, m.inject)
			_ = flush(m.ResponseWriter, buf[at:])
			return
		}
	}
	// No recognizable document shape: flush verbatim rather than risk
	// corrupting a body the shell contract did not promise.
	_ = m.emitPassthrough()
}

func flush(w io.Writer, b []byte) error {
	if len(b) == 0 {
		return nil
	}
	_, err := w.Write(b)
	return err
}

// htmlShellCandidate reports whether the response headers describe an identity
// (uncompressed) HTML body — the only kind shellMetaWriter will touch.
func htmlShellCandidate(h http.Header) bool {
	if h.Get("Content-Encoding") != "" {
		return false
	}
	return strings.Contains(h.Get("Content-Type"), "text/html")
}

// indexFold is a case-insensitive bytes.Index for ASCII needles.
func indexFold(b, needle []byte) int {
	if len(b) < len(needle) {
		return -1
	}
	fold := make([]byte, len(b))
	for i := range b {
		c := b[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		fold[i] = c
	}
	return bytes.Index(fold, needle)
}

// trailingSlashRedirect reports whether a GET/HEAD request path is a
// trailing-slash twin of a canonical page path and returns the redirect
// target (query preserved). Rules, aligned with the rest of the package
// (cacheKey rejects trailing slashes, validPattern forbids them in route
// patterns, so no layer can ever serve the slashed form):
//
//   - "/" and paths whose last segment carries a file extension are exempt —
//     the former is the canonical root, the latter are asset-shaped URLs that
//     never matched a page route anyway;
//   - all trailing slashes collapse in one hop (/foo// → /foo), so the target
//     itself never triggers another redirect.
func trailingSlashRedirect(path, rawQuery string) (string, bool) {
	if len(path) < 2 || !strings.HasSuffix(path, "/") {
		return "", false
	}
	cleaned := strings.TrimRight(path, "/")
	if cleaned == "" {
		return "", false
	}
	if seg := cleaned[strings.LastIndexByte(cleaned, '/')+1:]; strings.Contains(seg, ".") {
		return "", false
	}
	if rawQuery != "" {
		cleaned += "?" + rawQuery
	}
	return cleaned, true
}

// spaTier splits SPA-fallback requests into page shells and static assets
// (last segment carries a file extension) so traffic counts can separate them.
// Heuristic boundary (same shape as frontendHandler's 404 rule): a page route
// whose last segment contains a dot (/blog/v1.2) lands in the asset bucket —
// acceptable for observation buckets; tighten here if a product grows such routes.
func spaTier(p string) string {
	if i := strings.LastIndexByte(p, '/'); strings.Contains(p[i+1:], ".") {
		return TierAsset
	}
	return TierSPA
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
