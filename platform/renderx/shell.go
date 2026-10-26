package renderx

import (
	"regexp"
	"strings"
)

// ShellHead carries the pieces of the Vite shell (web/dist/index.html) that
// RenderDocument must inherit when it rebuilds a document from scratch.
// RenderDocument does not rewrite the shell; it composes a fresh document, so
// anything that only lives in the shell head (favicon links, theme-color,
// modulepreload hints) and the html/body open-tag attributes (e.g. a warm
// background color that prevents FOUC) would otherwise be dropped on every
// prerendered and SSR-rendered page. The product parses the shell once at
// startup (or once per prerender run) and attaches the result to ViteAssets.
type ShellHead struct {
	// HeadTags are the shell's <link> and <meta> tags after exclusion (see
	// ParseShellHead): stylesheets, meta charset, meta viewport and <title>
	// never appear here — each has its own channel (Document.CSS, the
	// mandatory charset line, the viewport fallback, the page's own title).
	HeadTags []HeadEntry

	// HTMLAttrs are the attributes of the shell's <html> open tag minus
	// `lang` (Document.Lang owns lang).
	HTMLAttrs map[string]string

	// BodyAttrs are the attributes of the shell's <body> open tag, verbatim.
	BodyAttrs map[string]string
}

// The Vite shell is a machine-generated document with a stable shape, so a
// regex scan is the right cost/benefit here (no golang.org/x/net/html
// dependency for five tags). Attribute values containing '>' would break the
// tag matching; Vite never emits those in the shell head.
var (
	shellHeadBlockRE = regexp.MustCompile(`(?is)<head\b[^>]*>(.*?)</head>`)
	shellCommentRE   = regexp.MustCompile(`(?s)<!--.*?-->`)
	shellHeadTagRE   = regexp.MustCompile(`(?i)<(link|meta)\b([^>]*?)/?>`)
	shellHTMLOpenRE  = regexp.MustCompile(`(?is)<html\b([^>]*)>`)
	shellBodyOpenRE  = regexp.MustCompile(`(?is)<body\b([^>]*)>`)
	shellAttrRE      = regexp.MustCompile(`([a-zA-Z_][a-zA-Z0-9_:.-]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'=<>` + "`" + `]+))?`)
)

// ParseShellHead extracts ShellHead from a Vite shell document. It is a pure
// function that never fails: a missing head, missing tags or attributes, or
// tags the head-entry whitelist would reject all degrade to "not inherited"
// (empty/absent results) rather than erroring — the shell is build output the
// framework does not control, and a quirky shell must never block rendering.
//
// Exclusion rules (each excluded kind has a dedicated, overridable channel):
//
//   - <link> whose rel token list contains "stylesheet" — CSS goes through
//     Document.CSS (the manifest-derived, deduplicated list);
//   - <meta charset> — RenderDocument always writes its own charset line;
//   - <meta name="viewport"> — covered by the viewport fallback and its
//     page-head override rule;
//   - everything that is not <link> or <meta> (<title>, <script>, …) — the
//     page owns its title, and scripts have their own injection channel.
//
// Everything else is kept, including rel=modulepreload, rel=icon,
// rel=preconnect and meta name=theme-color.
func ParseShellHead(shellHTML string) ShellHead {
	var out ShellHead
	if head := shellHeadBlockRE.FindStringSubmatch(shellHTML); head != nil {
		// Strip comments first: a commented-out link/meta must stay dead —
		// the tag scan below would otherwise resurrect it (audit 2026-10-26).
		headContent := shellCommentRE.ReplaceAllString(head[1], "")
		// One combined scan keeps the shell's document order (links and metas
		// interleaved as written); group 2 is the attribute region only, so
		// the tag name never leaks into parseShellAttrs as a bare attribute.
		for _, m := range shellHeadTagRE.FindAllStringSubmatch(headContent, -1) {
			if e, ok := shellEntry(strings.ToLower(m[1]), m[2]); ok {
				out.HeadTags = append(out.HeadTags, e)
			}
		}
	}
	if m := shellHTMLOpenRE.FindStringSubmatch(shellHTML); m != nil {
		attrs, clean := parseShellAttrs(m[1])
		deleteFold(attrs, "lang") // Document.Lang owns lang
		if len(attrs) > 0 && clean {
			out.HTMLAttrs = attrs
		}
	}
	if m := shellBodyOpenRE.FindStringSubmatch(shellHTML); m != nil {
		attrs, clean := parseShellAttrs(m[1])
		if len(attrs) > 0 && clean {
			out.BodyAttrs = attrs
		}
	}
	return out
}

// shellEntry converts one shell tag into a HeadEntry, applying the exclusion
// rules and the renderHeadEntry whitelist. ok=false means "excluded or not
// whitelisted" — the caller silently skips it.
func shellEntry(tag, openTag string) (HeadEntry, bool) {
	attrs, clean := parseShellAttrs(openTag)
	if !clean {
		// The tag carries an attribute the whitelist rejects (e.g. a meta
		// http-equiv). Emitting a mutated husk would misrepresent the shell;
		// dropping the whole tag keeps the pipeline graceful and honest.
		return HeadEntry{}, false
	}
	switch tag {
	case "link":
		if hasRelToken(attrs["rel"], "stylesheet") {
			return HeadEntry{}, false
		}
	case "meta":
		if _, ok := attrs["charset"]; ok {
			return HeadEntry{}, false
		}
		if name, ok := attrs["name"]; ok && strings.EqualFold(name, "viewport") {
			return HeadEntry{}, false
		}
	}
	e := HeadEntry{Tag: tag}
	if len(attrs) > 0 {
		e.Attrs = attrs
	}
	if _, err := renderHeadEntry(e); err != nil {
		return HeadEntry{}, false
	}
	return e, true
}

// parseShellAttrs pulls name="value" / name='value' / bare-name attributes
// out of a tag body. The trailing "/" of a self-closing tag has no "="
// following it, so it never matches as an attribute value. Values are
// returned HTML-unquoted (still entity-encoded); RenderDocument re-escapes
// on output. clean=false reports that an attribute name was dropped because
// it is outside the whitelist (attrRE/denyAttr) — the caller drops the whole
// tag rather than emitting a mutated version of it.
func parseShellAttrs(s string) (attrs map[string]string, clean bool) {
	clean = true
	for _, m := range shellAttrRE.FindAllStringSubmatch(s, -1) {
		name := strings.ToLower(m[1])
		if !attrRE.MatchString(name) || denyAttr(name) {
			clean = false
			continue
		}
		value := strings.TrimSpace(m[2])
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if attrs == nil {
			attrs = map[string]string{}
		}
		attrs[name] = value
	}
	return attrs, clean
}

// hasRelToken reports whether the rel value (a space-separated token list per
// the HTML spec) contains tok, case-insensitively.
func hasRelToken(rel, tok string) bool {
	for _, t := range strings.Fields(rel) {
		if strings.EqualFold(t, tok) {
			return true
		}
	}
	return false
}

// deleteFold removes key from m ignoring ASCII case (attribute names are
// case-insensitive in HTML).
func deleteFold(m map[string]string, key string) {
	for k := range m {
		if strings.EqualFold(k, key) {
			delete(m, k)
		}
	}
}
