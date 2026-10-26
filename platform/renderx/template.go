package renderx

import (
	"bytes"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

type HeadEntry struct {
	Tag      string            `json:"tag"`
	Attrs    map[string]string `json:"attrs,omitempty"`
	Children string            `json:"children,omitempty"`
}

type Document struct {
	Lang          string
	Head          []HeadEntry
	CSS           []string
	BodyHTML      string
	PropsJSON     []byte
	PageID        string
	HydrateScript string
	// NoHydration 为真时不写 props 脚本。props 脚本唯一的消费者是客户端
	// 入口；没有入口的文档里它只是把页面数据白发给每个访客（hydrate=none
	// 的零 JS 页），所以两者必须同进同退。
	NoHydration bool

	// InheritHead holds shell-level head entries (favicon links,
	// theme-color, rel=modulepreload …) that RenderDocument emits between the
	// viewport fallback and the page's own Head, before stylesheets — earlier
	// than CSS so preload/modulepreload hints are discovered early (F-4).
	// Entries whose (tag, rel/name/property) key collides with a page Head
	// entry are skipped: the page always wins over the shell. Typical source:
	// ParseShellHead, carried on ViteAssets.Shell by RenderOnce.
	InheritHead []HeadEntry

	// HTMLAttrs / BodyAttrs are extra attributes for the <html> / <body>
	// open tags (e.g. style="background:…" from the shell to prevent FOUC).
	// On <html> the lang attribute is ignored — Lang owns it.
	HTMLAttrs map[string]string
	BodyAttrs map[string]string

	// BaseURL, when set to an absolute http(s) origin, turns relative
	// og:image / twitter:image / og:url content values into absolute URLs
	// (crawlers and social scrapers require absolute URLs). Already-absolute
	// values and every other meta/link (canonical included) are untouched,
	// and an empty or non-absolute BaseURL disables the rewrite entirely.
	// This covers only the server-rendered first HTML; client-side head
	// updates after SPA navigation keep whatever the page emits (deliberate
	// boundary: crawlers read the first HTML only).
	BaseURL string
}

// viewportFallback is written right after the charset line unless the page
// (or the inherited shell head) already declares its own viewport — a page
// that needs user-scalable=no etc. overrides it via a meta[name=viewport]
// head entry.
const viewportFallback = `<meta name="viewport" content="width=device-width, initial-scale=1">`

var htmlReplacer = strings.NewReplacer(
	`&`, "&amp;",
	`'`, "&#39;",
	`<`, "&lt;",
	`>`, "&gt;",
	`"`, "&#34;",
)

func escapeHTML(s string) string { return htmlReplacer.Replace(s) }

var (
	tagRE  = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9-]*$`)
	attrRE = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9:._-]*$`)
)

var denyTags = map[string]bool{
	"script": true, "iframe": true, "object": true, "embed": true,
	"frame": true, "applet": true, "base": true,
}

var denyAttrs = map[string]bool{"http-equiv": true}

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true,
	"hr": true, "img": true, "input": true, "link": true, "meta": true,
	"param": true, "source": true, "track": true, "wbr": true,
}

func escapePropsJSON(b []byte) []byte {
	return bytes.ReplaceAll(b, []byte("<"), []byte(`\u003c`))
}

var (
	linkTagRE = regexp.MustCompile(`(?i)^<link\b[^>]*>$`)
	relAttrRE = regexp.MustCompile(`(?i)\brel="([^"]*)"`)
)

// hoistLeadingPreloads splits off the leading run of `<link rel="preload">`
// tags at the very start of the body HTML.
//
// React 19 float emits one preload link per non-lazy <img> (plus fonts/styles
// preloads when asked), and renderToString embeds them inside #root — where a
// preload scanner discovers them far later than in <head>, losing most of the
// head start. Only the contiguous run that starts at byte 0 of the body HTML is
// considered: the first byte that is not a preload link — a `<!--$-->` suspense
// marker, any other tag, text, even leading whitespace — stops the scan and
// everything from there on stays in the body verbatim (conservative by design;
// a missed hoist costs a bit of latency, a wrong one costs hydration markers).
// No-preload input returns the input unchanged so the assembled document stays
// byte-identical.
func hoistLeadingPreloads(body string) (tags []string, rest string) {
	pos := 0
	for {
		s := body[pos:]
		if !strings.HasPrefix(s, "<link") {
			break
		}
		end := strings.IndexByte(s, '>')
		if end < 0 || strings.Contains(s[1:end], "<") {
			break
		}
		tag := s[:end+1]
		if !isPreloadLinkTag(tag) {
			break
		}
		tags = append(tags, tag)
		pos += end + 1
	}
	if pos == 0 {
		return nil, body
	}
	return tags, body[pos:]
}

// isPreloadLinkTag reports whether tag is a well-formed <link> whose rel value
// (a space-separated token list, HTML spec) contains "preload". Attribute
// matching is limited to double-quoted values — the only form React emits;
// anything else fails the match and is left in place.
func isPreloadLinkTag(tag string) bool {
	if !linkTagRE.MatchString(tag) {
		return false
	}
	m := relAttrRE.FindStringSubmatch(tag)
	if m == nil {
		return false
	}
	for _, tok := range strings.Fields(m[1]) {
		if strings.EqualFold(tok, "preload") {
			return true
		}
	}
	return false
}

func RenderDocument(doc Document) ([]byte, error) {
	props := doc.PropsJSON
	if len(props) == 0 {
		props = []byte("{}")
	}
	if len(props) > MaxPropsBytes {
		return nil, fmt.Errorf("%w: %d bytes > %d", ErrPropsTooLarge, len(props), MaxPropsBytes)
	}
	// Float preloads lifted into <head> (see hoistLeadingPreloads); everything
	// else in the body stays byte-for-byte.
	preloads, bodyHTML := hoistLeadingPreloads(doc.BodyHTML)

	htmlAttrs, err := renderTagAttrs(doc.HTMLAttrs, "html")
	if err != nil {
		return nil, err
	}
	bodyAttrs, err := renderTagAttrs(doc.BodyAttrs, "body")
	if err != nil {
		return nil, err
	}
	base := normalizedBaseURL(doc.BaseURL)

	var buf bytes.Buffer
	buf.WriteString("<!doctype html>\n")
	buf.WriteString(`<html lang="` + escapeHTML(doc.Lang) + `"` + htmlAttrs + `>` + "\n")
	buf.WriteString("<head>\n")
	buf.WriteString("  <meta charset=\"utf-8\">\n")
	// Viewport fallback (F-1): mobile rendering depends on it and a missing
	// one is a silent, site-wide ranking penalty. The page (or an inherited
	// shell entry) overrides it by declaring its own meta[name=viewport].
	if !hasViewportMeta(doc.Head) && !hasViewportMeta(doc.InheritHead) {
		buf.WriteString("  " + viewportFallback + "\n")
	}
	// Inherited shell head (favicon / theme-color / modulepreload …) before
	// the page's own head and before the stylesheets; page entries win on
	// (tag, rel/name/property) collisions.
	pageKeys := headKeys(doc.Head)
	for _, e := range doc.InheritHead {
		if k, ok := headKey(e); ok && pageKeys[k] {
			continue
		}
		s, err := renderHeadEntry(absolutizeSocial(e, base))
		if err != nil {
			return nil, err
		}
		buf.WriteString("  " + s + "\n")
	}
	for _, e := range doc.Head {
		s, err := renderHeadEntry(absolutizeSocial(e, base))
		if err != nil {
			return nil, err
		}
		buf.WriteString("  " + s + "\n")
	}
	// Preloads go before the stylesheets: they start high-priority fetches the
	// render-blocking CSS download would otherwise queue behind, which is the
	// whole point of hoisting them out of the body.
	for _, tag := range preloads {
		buf.WriteString("  " + tag + "\n")
	}
	for _, href := range doc.CSS {
		buf.WriteString(`  <link rel="stylesheet" href="` + escapeHTML(href) + `">` + "\n")
	}
	buf.WriteString("</head>\n")
	buf.WriteString("<body" + bodyAttrs + ">\n")
	buf.WriteString(`  <div id="root">` + bodyHTML + `</div>` + "\n")
	if !doc.NoHydration {
		propsScript := `<script type="application/json" id="__PLOYKIT_PROPS__"`
		if doc.PageID != "" {
			propsScript += ` data-page-id="` + escapeHTML(doc.PageID) + `"`
		}
		propsScript += `>` + string(escapePropsJSON(props)) + `</script>`
		buf.WriteString("  " + propsScript + "\n")
		if doc.HydrateScript != "" {
			buf.WriteString("  " + doc.HydrateScript + "\n")
		}
	}
	buf.WriteString("</body>\n")
	buf.WriteString("</html>\n")
	return buf.Bytes(), nil
}

// renderTagAttrs serializes an <html>/<body> open-tag attribute map (sorted
// for determinism, values escaped) with a leading space per attribute, "" for
// an empty map. Names go through the same whitelist as head entries, with the
// same error contract: a malformed name is a wiring bug and fails the render.
func renderTagAttrs(attrs map[string]string, tag string) (string, error) {
	if len(attrs) == 0 {
		return "", nil
	}
	names := make([]string, 0, len(attrs))
	for k := range attrs {
		if !attrRE.MatchString(k) || denyAttrs[k] {
			return "", fmt.Errorf("%w: attr %q on <%s>", ErrInvalidHeadTag, k, tag)
		}
		names = append(names, k)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, k := range names {
		b.WriteString(` ` + k + `="` + escapeHTML(attrs[k]) + `"`)
	}
	return b.String(), nil
}

// hasViewportMeta reports whether entries declare a meta[name=viewport].
func hasViewportMeta(entries []HeadEntry) bool {
	for _, e := range entries {
		if strings.EqualFold(e.Tag, "meta") {
			if name, ok := e.Attrs["name"]; ok && strings.EqualFold(name, "viewport") {
				return true
			}
		}
	}
	return false
}

// headKey returns the dedup identity of a head entry: tag plus the value of
// its rel (link) or name/property (meta) attribute, normalized. ok=false for
// entries with no identifying attribute (they can never collide).
func headKey(e HeadEntry) (string, bool) {
	switch strings.ToLower(e.Tag) {
	case "link":
		if rel, ok := e.Attrs["rel"]; ok && rel != "" {
			return "link " + normalizeRel(rel), true
		}
	case "meta":
		if v, ok := e.Attrs["name"]; ok && v != "" {
			return "meta name " + strings.ToLower(v), true
		}
		if v, ok := e.Attrs["property"]; ok && v != "" {
			return "meta property " + strings.ToLower(v), true
		}
	}
	return "", false
}

func headKeys(entries []HeadEntry) map[string]bool {
	var out map[string]bool
	for _, e := range entries {
		if k, ok := headKey(e); ok {
			if out == nil {
				out = map[string]bool{}
			}
			out[k] = true
		}
	}
	return out
}

// normalizeRel lowercases and sorts an rel token list so "shortcut icon" and
// "icon shortcut" compare equal.
func normalizeRel(rel string) string {
	toks := strings.Fields(strings.ToLower(rel))
	sort.Strings(toks)
	return strings.Join(toks, " ")
}

// normalizedBaseURL validates a BaseURL candidate: an absolute http(s) origin
// (a path suffix is allowed and joined verbatim), with surrounding space and
// trailing slashes trimmed. Anything else — including the empty string —
// yields "", which disables URL absolutization.
func normalizedBaseURL(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return raw
}

// socialAbsolutizeTargets are the meta keys whose content must be absolute
// (social scrapers drop relative values); canonical is deliberately absent —
// a relative canonical is legal.
var socialAbsolutizeTargets = map[string]bool{
	"og:image":      true,
	"twitter:image": true,
	"og:url":        true,
}

// absolutizeSocial rewrites a head entry's content attribute against base
// when the entry is an og:image / twitter:image / og:url meta with a relative
// value. base == "" (or an already-absolute / protocol-relative / fragment
// value) returns the entry unchanged, and rewritten entries get a fresh Attrs
// map so the caller's slices stay untouched (copy-on-write).
func absolutizeSocial(e HeadEntry, base string) HeadEntry {
	if base == "" || !strings.EqualFold(e.Tag, "meta") {
		return e
	}
	key := e.Attrs["name"]
	if key == "" {
		key = e.Attrs["property"]
	}
	if !socialAbsolutizeTargets[strings.ToLower(key)] {
		return e
	}
	content := e.Attrs["content"]
	if content == "" {
		return e
	}
	abs := joinBaseURL(base, content)
	if abs == content {
		return e
	}
	attrs := make(map[string]string, len(e.Attrs))
	for k, v := range e.Attrs {
		attrs[k] = v
	}
	attrs["content"] = abs
	e.Attrs = attrs
	return e
}

// joinBaseURL prefixes a relative URL with an absolute base. Absolute URLs
// (any scheme), protocol-relative (//host/…) and fragment (#…) values are
// returned unchanged.
func joinBaseURL(base, v string) string {
	if u, err := url.Parse(v); err == nil && u.IsAbs() {
		return v
	}
	if strings.HasPrefix(v, "//") || strings.HasPrefix(v, "#") {
		return v
	}
	if strings.HasPrefix(v, "/") {
		return base + v
	}
	return base + "/" + v
}

func renderHeadEntry(e HeadEntry) (string, error) {
	if !tagRE.MatchString(e.Tag) || denyTags[e.Tag] {
		return "", fmt.Errorf("%w: tag %q", ErrInvalidHeadTag, e.Tag)
	}
	names := make([]string, 0, len(e.Attrs))
	for k := range e.Attrs {
		if !attrRE.MatchString(k) || denyAttrs[k] {
			return "", fmt.Errorf("%w: attr %q on <%s>", ErrInvalidHeadTag, k, e.Tag)
		}
		names = append(names, k)
	}
	sort.Strings(names)

	var b strings.Builder
	b.WriteByte('<')
	b.WriteString(e.Tag)
	for _, k := range names {
		b.WriteString(` ` + k + `="` + escapeHTML(e.Attrs[k]) + `"`)
	}
	b.WriteByte('>')
	if voidElements[e.Tag] {
		return b.String(), nil
	}
	b.WriteString(escapeHTML(e.Children))
	b.WriteString("</" + e.Tag + ">")
	return b.String(), nil
}
