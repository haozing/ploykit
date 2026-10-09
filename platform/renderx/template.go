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

func RenderDocument(doc Document) ([]byte, error) {
	props := doc.PropsJSON
	if len(props) == 0 {
		props = []byte("{}")
	}
	if len(props) > MaxPropsBytes {
		return nil, fmt.Errorf("%w: %d bytes > %d", ErrPropsTooLarge, len(props), MaxPropsBytes)
	}

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
	for _, href := range doc.CSS {
		buf.WriteString(`  <link rel="stylesheet" href="` + escapeHTML(href) + `">` + "\n")
	}
	buf.WriteString("</head>\n")
	buf.WriteString("<body>\n")
	buf.WriteString(`  <div id="root">` + doc.BodyHTML + `</div>` + "\n")
	propsScript := `<script type="application/json" id="__PLOYKIT_PROPS__"`
	if doc.PageID != "" {
		propsScript += ` data-page-id="` + escapeHTML(doc.PageID) + `"`
	}
	propsScript += `>` + string(escapePropsJSON(props)) + `</script>`
	buf.WriteString("  " + propsScript + "\n")
	if doc.HydrateScript != "" {
		buf.WriteString("  " + doc.HydrateScript + "\n")
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
