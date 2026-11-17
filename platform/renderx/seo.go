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

	// Lastmod optionally reports the last-modified time for one sitemap URL.
	// location is the root-relative path ("/blog/hello"); params carries the
	// expanded route params (nil for parameterless routes). It runs per URL
	// during sitemap generation and may do I/O (that is its purpose), hence
	// the ctx — return ok=false to omit <lastmod> for that URL (unknown slug,
	// lookup failure: the entry degrades to loc-only, never a 500). Emitted
	// as a W3C date (YYYY-MM-DD, UTC-normalized) per sitemaps.org.
	Lastmod func(ctx context.Context, route RouteSpec, location string, params Params) (time.Time, bool)

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
		locs, err := sitemapEntries(r.Context(), routes, baseURL, opts, reg)
		if err != nil {
			http.Error(w, "sitemap 生成失败", http.StatusInternalServerError)
			return
		}
		var buf bytes.Buffer
		buf.WriteString(xml.Header)
		buf.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
		for _, e := range locs {
			buf.WriteString("  <url><loc>")
			xml.EscapeText(&buf, []byte(e.loc))
			buf.WriteString("</loc>")
			if !e.lastmod.IsZero() {
				// W3C date（YYYY-MM-DD，sitemaps.org 认可的最短 lastmod 形态；
				// UTC 归一后取日期，时区信息不进文件）。
				buf.WriteString("<lastmod>")
				buf.WriteString(e.lastmod.UTC().Format("2006-01-02"))
				buf.WriteString("</lastmod>")
			}
			buf.WriteString("</url>\n")
		}
		buf.WriteString("</urlset>\n")
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(buf.Bytes())
	})
}

// sitemapEntry 是 sitemap 的一条输出：loc 必有，lastmod 零值表示不带。
type sitemapEntry struct {
	loc     string
	lastmod time.Time
}

func sitemapEntries(ctx context.Context, routes []RouteSpec, baseURL string, opts SitemapOptions, reg *Registry) ([]sitemapEntry, error) {
	base := strings.TrimSuffix(baseURL, "/")
	var entries []sitemapEntry
	add := func(rt RouteSpec, loc string, params Params) {
		e := sitemapEntry{loc: base + loc}
		if opts.Lastmod != nil {
			if t, ok := opts.Lastmod(ctx, rt, loc, params); ok {
				// 零值时间视为"回调误报"，同样按无 lastmod 处理。
				e.lastmod = t
			}
		}
		entries = append(entries, e)
	}
	for _, rt := range routes {
		if rt.Render != ModeStatic {
			continue
		}
		if !hasParams(rt.Path) {
			if opts.Filter == nil || opts.Filter(rt, rt.Path, nil) {
				add(rt, rt.Path, nil)
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
			add(rt, loc, pp.Params)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].loc < entries[j].loc })
	return entries, nil
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

// indexNowKeyRE is the key grammar the IndexNow spec allows for ownership
// keys: 8–128 characters drawn from [a-zA-Z0-9-] (case-tolerant — the spec's
// canonical examples are lowercase, but mixed case is accepted).
var indexNowKeyRE = regexp.MustCompile(`^[a-zA-Z0-9-]{8,128}$`)

// IndexNowKeyHandler serves the IndexNow ownership-verification file: the
// engines prove key/host pairing by fetching https://host/{key}.txt and
// expecting the key itself as the file body (plain UTF-8 text, nothing else).
// The key is validated at construction — a malformed one panics at wiring
// time (same "malformed options explode at construction, never serving a
// silently wrong file" contract as RobotsHandler): 8–128 characters, only
// [a-zA-Z0-9-].
//
// Product wiring convention: the key is known at assembly time, so register a
// literal pattern — mux.Handle("/"+key+".txt", renderx.IndexNowKeyHandler(key)).
// A Go 1.22 ServeMux wildcard must span a whole path segment ("/{key}.txt" is
// not a valid pattern), which is no loss here: the literal route is exactly
// the one URL the protocol fetches. Drive the key from env (INDEXNOW_KEY) so
// rotating it is a config change + restart, never a rebuild.
func IndexNowKeyHandler(key string) http.Handler {
	if !indexNowKeyRE.MatchString(key) {
		panic(fmt.Sprintf("renderx: IndexNowKeyHandler key %q 不合法：须为 8–128 个字符，且只含 [a-zA-Z0-9-]（IndexNow 规范字符集）", key))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(HeaderTier, TierIndexNowKey)
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
		_, _ = io.WriteString(w, key)
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

// indexNowMaxURLs 是 IndexNow 单请求的 URL 条数上限，超出必须分批提交。
const indexNowMaxURLs = 10000

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
		// 红线（ADR 0007）：默认是带 30s 超时的包级普通客户端、不经 egressx
		// （端点可指向自建内网索引器）；egress 姿态只能由产品经 Client 注入。
		client = indexNowClient
	}
	for start := 0; start < len(urls); start += indexNowMaxURLs {
		end := start + indexNowMaxURLs
		if end > len(urls) {
			end = len(urls)
		}
		if err := indexNowPost(ctx, client, endpoint, deps.Host, deps.Key, urls[start:end], start/indexNowMaxURLs+1); err != nil {
			return err
		}
	}
	return nil
}

// indexNowPost 提交一批（batchNo 为 1 起批号，仅用于错误上下文）。逐批串行：
// 调用方能尽早拿到第一个拒绝的批次，而不是等全部批次打完。
func indexNowPost(ctx context.Context, client *http.Client, endpoint, host, key string, urls []string, batchNo int) error {
	payload, err := json.Marshal(struct {
		Host    string   `json:"host"`
		Key     string   `json:"key"`
		URLList []string `json:"urlList"`
	}{Host: host, Key: key, URLList: urls})
	if err != nil {
		return fmt.Errorf("renderx: IndexNow 第 %d 批序列化失败: %w", batchNo, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("renderx: IndexNow 第 %d 批构造请求失败: %w", batchNo, err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("renderx: IndexNow 第 %d 批推送失败: %w", batchNo, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// IndexNow 用小 JSON body 说明拒绝原因（bad key / key not valid 等），
		// 只回状态码等于把诊断信息丢掉——这里把 body 片段带进错误。
		snippet := indexNowErrorSnippet(resp.Body)
		msg := fmt.Sprintf("renderx: IndexNow 第 %d 批推送被拒: HTTP %d（key 校验未通过或 host 不符？）", batchNo, resp.StatusCode)
		if snippet != "" {
			msg += " 响应体: " + snippet
		}
		return errors.New(msg)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// indexNowErrorSnippet 读取错误响应体的前 200 字节并压成单行（连续空白折成
// 单个空格），多行 JSON body 也无法向错误信息注入换行；余量排空以保住连接
// 复用。
func indexNowErrorSnippet(r io.Reader) string {
	b, _ := io.ReadAll(io.LimitReader(r, 200))
	_, _ = io.Copy(io.Discard, r)
	return strings.Join(strings.Fields(string(b)), " ")
}
