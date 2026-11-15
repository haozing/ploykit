package videoapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"text/template"
	"io"
	"net/url"
	"strings"

	"github.com/haozing/ploykit/platform/storagex"
)

//go:embed assets/gsap.min.js
var gsapFS embed.FS

//go:embed timeline-builder.js
var builderFS embed.FS

// AssetResolver maps a storagex key to the URL form the projected document
// should use. The render path and the preview path share one projector: the
// ONLY difference between them is this resolver (§4.4.1 — DOM and timeline
// are byte-identical).
type AssetResolver interface {
	// Preview returns the same-origin authorized URL /api/video/files/<key>;
	// Render returns a data: URI (worker preloads via storagex.Open).
	URL(ctx context.Context, key string) (string, error)
}

// PreviewResolver produces same-origin /api/video/files/<key> URLs under the
// given origin (empty origin = relative URLs, same-origin document).
type PreviewResolver struct{}

func (PreviewResolver) URL(_ context.Context, key string) (string, error) {
	if !storagex.ValidKey(key) {
		return "", fmt.Errorf("invalid storage key %q", key)
	}
	if !strings.HasPrefix(key, "video/") {
		return "", fmt.Errorf("key %q is outside the video domain", key)
	}
	return "/api/video/files/" + escapeKeyPath(key), nil
}

// escapeKeyPath percent-encodes each segment (storagex.escapeKey equivalent,
// kept local to avoid depending on unexported state).
func escapeKeyPath(key string) string {
	segs := strings.Split(key, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return strings.Join(segs, "/")
}

// DataURIResolver inlines object bytes as data: URIs (render path: the
// document must not touch the network — §4.4.5). loader is storagex.Open.
type DataURIResolver struct {
	Loader func(ctx context.Context, key string) (io.ReadCloser, storagex.Object, error)
}

func (r DataURIResolver) URL(ctx context.Context, key string) (string, error) {
	if r.Loader == nil {
		return "", fmt.Errorf("video: data resolver loader not wired")
	}
	body, obj, err := r.Loader(ctx, key)
	if err != nil {
		return "", fmt.Errorf("preload %s: %w", key, err)
	}
	defer body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(body); err != nil {
		return "", err
	}
	media := obj.ContentType
	if media == "" {
		media = "application/octet-stream"
	}
	return "data:" + media + ";base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// Projector renders one IR into the self-contained player document (§4.4.1).
type Projector struct {
	assets AssetResolver
}

func NewProjector(resolver AssetResolver) *Projector {
	if resolver == nil {
		resolver = PreviewResolver{}
	}
	return &Projector{assets: resolver}
}

// GSAPJS returns the vendored gsap bundle (also used by the CSP hash helper).
func GSAPJS() ([]byte, error) { return gsapFS.ReadFile("assets/gsap.min.js") }

// BuilderJS returns the timeline builder source.
func BuilderJS() ([]byte, error) { return builderFS.ReadFile("timeline-builder.js") }

// InlineScriptHash returns the 'sha256-...' CSP source expression covering
// the exact inline script the projector emits (gsap + builder + boot). §4.4.4:
// constant scripts pass by hash; the IR data block is a non-executable
// <script type="application/json"> and needs no hash.
func InlineScriptHash() (string, error) {
	g, err := GSAPJS()
	if err != nil {
		return "", err
	}
	b, err := BuilderJS()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(inlineScript(g, b))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'", nil
}

func inlineScript(gsap, builder []byte) []byte {
	return append(append(append([]byte{}, gsap...), builder...), bootJS...)
}

type projection struct {
	Width, Height int
	FPS           int
	// IRJSON is the data-block payload, inserted via text/template.
	// html/template CANNOT be used here: inside a
	// <script type="application/json"> context it applies its script-JSON
	// escaping to the blob, emitting a quoted JS string literal —
	// JSON.parse(textContent) then returns a string and the player silently
	// loses the IR (delivery-audit-video-studio §3 N1). text/template is safe
	// because the value is not raw user content: it is
	// escapeJSONBlock(json.Marshal(...)) — encoding/json escapes <, >, & as
	// \u003c/\u003e/\u0026 by default and escapeJSONBlock closes the
	// </script> early-closure hole. Injection tests in projector_test.go pin
	// both layers.
	IRJSON string
	// InlineScript is the verbatim embedded player bundle (vendored gsap +
	// timeline-builder + boot). Inserted via text/template; it is served
	// under a hash-pinned CSP (§4.4.4) and its bytes are locked by
	// TestInlineScriptHash_MatchesEmittedScript.
	InlineScript string
}

// bootJS starts the builder; the builder installs window.__player itself.
var bootJS = []byte(`
if (window.__player && window.__player.seek) { window.__player.seek(0); }
`)

// HTML renders the full document (§4.4.1). The IR rides in a
// script[type="application/json"] data block (not executable; outside
// script-src; builder reads textContent), so the hash CSP of §4.4.4 holds.
func (p *Projector) HTML(ctx context.Context, ir *IR, _ string) ([]byte, error) {
	gsap, err := GSAPJS()
	if err != nil {
		return nil, fmt.Errorf("embed gsap: %w", err)
	}
	builder, err := BuilderJS()
	if err != nil {
		return nil, fmt.Errorf("embed builder: %w", err)
	}

	// Resolve every element image src through the resolver (preview:
	// authorized URL; render: data URI).
	elements := make([]map[string]any, 0, len(ir.Elements))
	for _, el := range ir.Elements {
		m := elementMap(el)
		if el.Type == ElementImage && el.Src != "" {
			u, uerr := p.assets.URL(ctx, el.Src)
			if uerr != nil {
				return nil, uerr
			}
			m["src"] = u
		}
		elements = append(elements, m)
	}
	schemaVersion := ir.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = IRSchemaVersion // in-memory IRs predate stamping
	}
	payload := map[string]any{
		"schemaVersion": schemaVersion,
		"meta":     ir.Meta,
		"script":   ir.Script,
		"words":    ir.Words,
		"effects":  ir.Effects,
		"elements": elements,
		"audio":    ir.Audio,
	}
	irJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	tpl := template.Must(template.New("player").Parse(playerTemplate))
	var out bytes.Buffer
	err = tpl.Execute(&out, projection{
		Width:        ir.Meta.Width,
		Height:       ir.Meta.Height,
		FPS:          ir.Meta.FPS,
		IRJSON:       escapeJSONBlock(irJSON),
		InlineScript: string(append(append(append([]byte{}, gsap...), builder...), bootJS...)),
	})
	if err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// escapeJSONBlock prevents </script> early closure inside the data block:
// every "</" becomes "<\/" which JSON.parse treats identically.
func escapeJSONBlock(b []byte) string {
	s := string(b)
	s = strings.ReplaceAll(s, "</", "<\\/")
	return s
}

// elementMap converts an Element to the JSON-friendly map the builder
// consumes (explicit keys, not reflection, so unknown fields drop cleanly).
func elementMap(el Element) map[string]any {
	m := map[string]any{
		"id":   el.ID,
		"type": el.Type,
		"x":    el.X,
		"y":    el.Y,
		"w":    el.W,
		"h":    el.H,
		"z":    el.Z,
	}
	if el.Src != "" {
		m["src"] = el.Src
	}
	if el.Text != "" {
		m["text"] = el.Text
	}
	if el.Color != "" {
		m["color"] = el.Color
	}
	if el.FontSize != 0 {
		m["fontSize"] = el.FontSize
	}
	if len(el.Animations) > 0 {
		ans := make([]map[string]any, 0, len(el.Animations))
		for _, an := range el.Animations {
			am := map[string]any{
				"id":             an.ID,
				"type":           an.Type,
				"durationFrames": an.DurationFrames,
			}
			if an.From != nil {
				am["from"] = an.From
			}
			if an.To != nil {
				am["to"] = an.To
			}
			if an.FromValue != nil {
				am["fromValue"] = *an.FromValue
			}
			if an.ToValue != nil {
				am["toValue"] = *an.ToValue
			}
			if an.StartAnchor != nil {
				am["startAnchor"] = an.StartAnchor
			}
			if an.Easing != "" {
				am["easing"] = an.Easing
			}
			if an.ResolvedFrom != nil {
				am["resolvedFrom"] = an.ResolvedFrom
			}
			ans = append(ans, am)
		}
		m["animations"] = ans
	}
	return m
}

const playerTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>ploykit video preview</title>
<style>
  html, body { margin: 0; padding: 0; background: #111; }
  #stage {
    position: relative;
    width: {{.Width}}px;
    height: {{.Height}}px;
    background: #000;
    overflow: hidden;
    transform-origin: top left;
  }
  #canvas { position: absolute; inset: 0; }
  .el { position: absolute; will-change: transform; }
  .el img, img.el { width: 100%; height: 100%; object-fit: contain; }
  .el-text {
    font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
    white-space: pre-wrap; line-height: 1.35; font-size: 48px; color: #fff;
  }
  .el-text.counter { font-size: 96px; font-weight: 700; }
  .el-shape { border-radius: 8px; }
</style>
</head>
<body>
<div id="stage"><div id="canvas"></div></div>
<script type="application/json" id="ploykit-ir">{{.IRJSON}}</script>
<script>
{{.InlineScript}}
</script>
</body>
</html>
`
