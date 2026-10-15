package renderx

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

const DefaultIndexNowEndpoint = "https://api.indexnow.org/indexnow"

type SitemapOptions struct {
	Filter func(route RouteSpec, location string, params Params) bool

	Registry *Registry
}

// SitemapHandler serves /sitemap.xml from the route table + Paths registry.
// baseURL must be an absolute http(s) origin (e.g. "https://example.com") —
// a malformed value panics at construction time; mount the route only when an
// origin is actually known (see example wiring for the env-driven pattern).
func SitemapHandler(routes []RouteSpec, baseURL string, opts SitemapOptions) http.Handler {
	if err := validateAbsoluteOrigin(baseURL); err != nil {
		panic(fmt.Sprintf("renderx: SitemapHandler baseURL %q 必须是绝对 http(s) origin: %v", baseURL, err))
	}
	reg := opts.Registry
	if reg == nil {
		reg = defaultRegistry
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(HeaderTier, TierSitemap)
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		locs, err := sitemapLocations(r.Context(), routes, baseURL, opts, reg)
		if err != nil {
			http.Error(w, "sitemap 生成失败", http.StatusInternalServerError)
			return
		}
		var buf bytes.Buffer
		buf.WriteString(xml.Header)
		buf.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
		for _, loc := range locs {
			buf.WriteString("  <url><loc>")
			xml.EscapeText(&buf, []byte(loc))
			buf.WriteString("</loc></url>\n")
		}
		buf.WriteString("</urlset>\n")
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(buf.Bytes())
	})
}

func sitemapLocations(ctx context.Context, routes []RouteSpec, baseURL string, opts SitemapOptions, reg *Registry) ([]string, error) {
	base := strings.TrimSuffix(baseURL, "/")
	var locs []string
	for _, rt := range routes {
		if rt.Render != ModeStatic {
			continue
		}
		if !hasParams(rt.Path) {
			if opts.Filter == nil || opts.Filter(rt, rt.Path, nil) {
				locs = append(locs, base+rt.Path)
			}
			continue
		}
		fn, err := reg.LookupPaths(rt.Path)
		if err != nil {
			return nil, fmt.Errorf("%w: sitemap 枚举 %q 需要 Paths", ErrMissingPaths, rt.Path)
		}
		instances, err := fn(ctx)
		if err != nil {
			return nil, fmt.Errorf("renderx: sitemap 枚举 %q 失败: %w", rt.Path, err)
		}
		for _, pp := range instances {
			loc, ok := ExpandPath(rt.Path, pp.Params)
			if !ok {
				continue
			}
			if opts.Filter != nil && !opts.Filter(rt, loc, pp.Params) {
				continue
			}
			locs = append(locs, base+loc)
		}
	}
	sort.Strings(locs)
	return locs, nil
}

// RobotsOptions configures RobotsHandler.
type RobotsOptions struct {
	// SitemapURL is emitted as a "Sitemap:" line when non-empty (pass an
	// absolute URL, e.g. "https://example.com/sitemap.xml").
	SitemapURL string

	// Disallow lists path prefixes emitted as "Disallow:" lines under the
	// default "User-agent: *" group (e.g. "/api/", "/admin").
	Disallow []string

	// Extra holds verbatim lines appended after the default block, for more
	// elaborate rules (further user-agent groups, Allow exceptions). Blank
	// lines are skipped.
	Extra []string
}

// RobotsHandler serves /robots.txt: one "User-agent: *" group with the
// configured Disallow prefixes, the extra verbatim lines, and the Sitemap
// pointer. Options are validated and serialized once at construction — a
// malformed option panics at wiring time, never serving a silently wrong file.
func RobotsHandler(opts RobotsOptions) http.Handler {
	body := renderRobots(opts)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(HeaderTier, TierRobots)
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return
		}
		_, _ = io.WriteString(w, body)
	})
}

// validateAbsoluteOrigin rejects anything that cannot serve as the origin of
// an absolute SEO URL: an empty string, a missing/non-http(s) scheme, or a
// missing host. Callers turn the error into a wiring-time panic (same
// "malformed options explode at construction" contract as RobotsHandler).
func validateAbsoluteOrigin(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("scheme 必须是 http/https，得到 %q", u.Scheme)
	}
	if u.Host == "" {
		return errors.New("缺少 host")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return errors.New("origin 不应带 query/fragment")
	}
	return nil
}

func renderRobots(opts RobotsOptions) string {
	var b strings.Builder
	b.WriteString("User-agent: *\n")
	for _, p := range opts.Disallow {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if !strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\r\n") {
			panic(fmt.Sprintf("renderx: robots Disallow %q must start with / and contain no newline", p))
		}
		if strings.Contains(p, "#") {
			// "#" starts a line comment for common robots parsers — the rule
			// would be silently truncated, i.e. a silently wrong file.
			panic(fmt.Sprintf("renderx: robots Disallow %q must not contain '#' (parsers treat it as a comment)", p))
		}
		b.WriteString("Disallow: " + p + "\n")
	}
	extra := make([]string, 0, len(opts.Extra))
	for _, line := range opts.Extra {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.ContainsAny(line, "\r\n") {
			panic(fmt.Sprintf("renderx: robots Extra line %q must not contain a newline", line))
		}
		extra = append(extra, line)
	}
	if len(extra) > 0 {
		b.WriteString("\n")
		for _, line := range extra {
			b.WriteString(line + "\n")
		}
	}
	if u := strings.TrimSpace(opts.SitemapURL); u != "" {
		if strings.ContainsAny(u, "\r\n") {
			panic(fmt.Sprintf("renderx: robots SitemapURL %q must not contain a newline", u))
		}
		if err := validateAbsoluteOrigin(u); err != nil {
			panic(fmt.Sprintf("renderx: robots SitemapURL %q 必须是绝对 http(s) URL: %v", u, err))
		}
		b.WriteString("Sitemap: " + u + "\n")
	}
	return b.String()
}

// SEOSignals is the head-level SEO signal set AuditSEO extracts from a
// rendered document. Empty strings mean the signal is absent.
type SEOSignals struct {
	Title       string
	Description string
	Canonical   string

	// CanonicalCount counts link[rel=canonical] elements (>1 = the page emits
	// duplicates). The SSR path does not dedupe head entries — one page, one
	// canonical is a product-side rule, and build-time audits warn on it.
	CanonicalCount int
}

// AuditSEO extracts the title / meta description / canonical link from a
// rendered document. It understands the serialization this package's template
// emits (lowercase tags, double-quoted attributes) — it audits our own output,
// not arbitrary HTML. Values come back HTML-unescaped. Build chains use it to
// report SEO coverage of prerendered pages (cmd/render does).
func AuditSEO(doc []byte) SEOSignals {
	var s SEOSignals
	if m := auditTitleRE.FindSubmatch(doc); m != nil {
		s.Title = html.UnescapeString(strings.TrimSpace(string(m[1])))
	}
	for _, tag := range auditMetaRE.FindAll(doc, -1) {
		attrs := auditAttrs(tag)
		if s.Description == "" && strings.EqualFold(attrs["name"], "description") {
			s.Description = html.UnescapeString(attrs["content"])
		}
	}
	for _, tag := range auditLinkRE.FindAll(doc, -1) {
		attrs := auditAttrs(tag)
		if strings.EqualFold(strings.TrimSpace(attrs["rel"]), "canonical") {
			s.CanonicalCount++
			if s.Canonical == "" {
				s.Canonical = html.UnescapeString(attrs["href"])
			}
		}
	}
	return s
}

var (
	auditTitleRE = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	auditMetaRE  = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	auditLinkRE  = regexp.MustCompile(`(?is)<link\b[^>]*>`)
	auditAttrRE  = regexp.MustCompile(`(?i)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"`)
)

func auditAttrs(tag []byte) map[string]string {
	out := map[string]string{}
	for _, m := range auditAttrRE.FindAllSubmatch(tag, -1) {
		out[strings.ToLower(string(m[1]))] = string(m[2])
	}
	return out
}

var indexNowClient = &http.Client{Timeout: 30 * time.Second}

type IndexNowDeps struct {
	Endpoint string

	Key string

	Host string

	Client *http.Client
}

func IndexNow(ctx context.Context, deps IndexNowDeps, urls []string) error {
	if deps.Key == "" || deps.Host == "" {
		return errors.New("renderx: IndexNow 需要 Key 与 Host")
	}
	if len(urls) == 0 {
		return nil
	}
	endpoint := deps.Endpoint
	if endpoint == "" {
		endpoint = DefaultIndexNowEndpoint
	}
	client := deps.Client
	if client == nil {
		client = indexNowClient
	}
	body, err := json.Marshal(struct {
		Host    string   `json:"host"`
		Key     string   `json:"key"`
		URLList []string `json:"urlList"`
	}{Host: deps.Host, Key: deps.Key, URLList: urls})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("renderx: IndexNow 推送失败: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("renderx: IndexNow 推送被拒: HTTP %d（key 校验未通过或 host 不符？）", resp.StatusCode)
	}
	return nil
}
