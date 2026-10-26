package renderx

import (
	"bytes"
	"fmt"
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
}

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

	var buf bytes.Buffer
	buf.WriteString("<!doctype html>\n")
	buf.WriteString(`<html lang="` + escapeHTML(doc.Lang) + `">` + "\n")
	buf.WriteString("<head>\n")
	buf.WriteString("  <meta charset=\"utf-8\">\n")
	for _, e := range doc.Head {
		s, err := renderHeadEntry(e)
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
	buf.WriteString("<body>\n")
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
