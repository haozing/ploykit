package videoapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/storagex"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func projectorIR() *IR {
	ir := validIR()
	ir.Elements = []Element{
		{ID: "sticker_1", Type: ElementImage, Src: "video/ws-1/assets/p1/abc.png",
			X: 100, Y: 100, W: 200, H: 200, Z: 1},
		{ID: "title_1", Type: ElementText, Text: "标题", Color: "#fff", FontSize: 64,
			X: 100, Y: 300, W: 800, H: 120, Z: 2},
	}
	ir.Effects = []Effect{{
		ID: "fx_1", Anchor: Anchor{Text: "发布", Occurrence: 0}, Type: EffectPulse,
		ResolvedFrom: &ResolvedFrom{WordIndex: 0, Reason: AnchorExact},
	}}
	return ir
}

func TestProjector_HTML_Preview(t *testing.T) {
	p := NewProjector(nil) // PreviewResolver default
	html, err := p.HTML(context.Background(), projectorIR(), "https://app.example.com")
	require.NoError(t, err)
	s := string(html)

	require.True(t, strings.HasPrefix(s, "<!DOCTYPE html>"), "full document")
	require.Contains(t, s, `<script type="application/json" id="ploykit-ir">`,
		"IR data block present (§4.4.4)")
	require.NotContains(t, s, "https://evil.example", "no external URLs")
	assert.Contains(t, s, "/api/video/files/video/ws-1/assets/p1/abc.png",
		"image resolved to authorized same-origin path")
	assert.Contains(t, s, "width: 1080px", "canvas geometry from meta")
	assert.Contains(t, s, "gsap", "gsap inlined")
	assert.Contains(t, s, "__player", "builder contract present")
}

func TestProjector_HTML_URLEscaping(t *testing.T) {
	// the IR JSON block must survive </script> (§4.4.4 note): craft a script
	// text containing the closing sequence and verify escaping.
	ir := validIR()
	ir.Script = "closing tag test </script><script>alert(1)</script>"
	ir.Elements = []Element{{ID: "t", Type: ElementText, Text: ir.Script, X: 0, Y: 0, W: 10, H: 10}}
	html, err := NewProjector(nil).HTML(context.Background(), ir, "")
	require.NoError(t, err)
	// encoding/json escapes < and > to \u003c/\u003e by default, which itself
	// prevents </script> early closure; escapeJSONBlock is defense in depth.
	b := html
	idx := bytes.Index(b, []byte(`id="ploykit-ir">`))
	require.GreaterOrEqual(t, idx, 0)
	end := bytes.Index(b[idx:], []byte(`</script>`))
	require.GreaterOrEqual(t, end, 0)
	block := string(b[idx : idx+end])
	assert.NotContains(t, block, "</scr", "no raw closing sequence inside the data block")
	assert.Contains(t, block, `\u003c/script`, "json < escaping applied")
}

func TestProjector_HTML_DataBlock_IsJSONObject(t *testing.T) {
	// Regression (delivery-audit-video-studio §3 N1): html/template escapes
	// string data in <script> contexts as a JS *expression* — the whole blob
	// came out quoted, so JSON.parse(textContent) returned a string and the
	// player silently lost the IR. The data block must carry the raw escaped
	// JSON object: it starts with '{"' and the round-trip keys survive.
	ir := projectorIR()
	html, err := NewProjector(nil).HTML(context.Background(), ir, "")
	require.NoError(t, err)
	s := string(html)

	start := strings.Index(s, `id="ploykit-ir">`) + len(`id="ploykit-ir">`)
	end := strings.Index(s[start:], `</script>`)
	require.GreaterOrEqual(t, end, 0)
	block := s[start : start+end]
	require.True(t, strings.HasPrefix(block, `{"`), "data block is a raw JSON object, not a quoted JS string")
	assert.Contains(t, block, `"meta"`, "meta key present")
	assert.Contains(t, block, `"elements"`, "elements key present")
}

func TestProjector_HTML_DataBlock_InjectionVectors(t *testing.T) {
	// Malicious text must not break out of the data block or spawn an
	// executable block: </script> early closure is the canonical vector.
	evil := `a</script><script>alert(1)</script>b`
	ir := validIR()
	ir.Script = evil
	ir.Elements = []Element{{ID: "e1", Type: ElementText, Text: evil, X: 0, Y: 0, W: 10, H: 10}}
	ir.Effects = nil
	html, err := NewProjector(nil).HTML(context.Background(), ir, "")
	require.NoError(t, err)
	s := string(html)

	// The attack must not materialize: no executable <script>alert block and
	// no unescaped closing sequence inside the DATA BLOCK (the document's own
	// structural </script> closers — data block end + inline script end — are
	// legitimate markup, so the assertion targets the block contents only).
	start := strings.Index(s, `id="ploykit-ir">`) + len(`id="ploykit-ir">`)
	end := strings.Index(s[start:], `</script>`)
	require.GreaterOrEqual(t, end, 0)
	block := s[start : start+end]
	require.NotContains(t, block, "</scr", "raw closing sequence inside the data block")
	require.NotContains(t, s, "<script>alert", "injected executable block")
	assert.Contains(t, block, `\u003c/script`, "json < escaping still applied")
}

func TestProjector_HTML_DataURI(t *testing.T) {
	png := []byte("PNGDATA")
	p := NewProjector(DataURIResolver{
		Loader: func(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			require.Equal(t, "video/ws-1/assets/p1/abc.png", key)
			return io.NopCloser(bytes.NewReader(png)), storagex.Object{ContentType: "image/png"}, nil
		},
	})
	html, err := p.HTML(context.Background(), projectorIR(), "")
	require.NoError(t, err)
	assert.Contains(t, string(html),
		"data:image/png;base64,"+base64.StdEncoding.EncodeToString(png),
		"render path inlines bytes as data URI")
	assert.NotContains(t, string(html), "/api/video/files/", "no network fetches in render path")
}

func TestInlineScriptHash_MatchesEmittedScript(t *testing.T) {
	// The CSP hash must cover exactly the inline script bytes the projector
	// emits (gsap + builder + boot). Compute the hash from a rendered doc and
	// compare with InlineScriptHash().
	g, err := GSAPJS()
	require.NoError(t, err)
	b, err := BuilderJS()
	require.NoError(t, err)
	sum := sha256.Sum256(inlineScript(g, b))
	want := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	got, err := InlineScriptHash()
	require.NoError(t, err)
	assert.Equal(t, want, got)
	// sanity: gsap is non-trivial and builder non-empty (embed wired)
	require.Greater(t, len(g), 10000)
	require.Greater(t, len(b), 1000)
}

func TestProjector_PayloadCarriesSchemaVersion(t *testing.T) {
	// The IR document carries its own contract version (schemaVersion); the
	// row-level optimistic-lock version is NOT part of the document
	// (delivery audit A-item: no double truth). Verified structurally via
	// JSON round-trip, not substring matching ("version" is a prefix of
	// "schemaVersion").
	html, err := NewProjector(nil).HTML(t.Context(), validIR(), "")
	require.NoError(t, err)
	str := string(html)
	marker := "id=\"ploykit-ir\">"
	start := strings.Index(str, marker) + len(marker)
	end := strings.Index(str[start:], "</script>")
	require.GreaterOrEqual(t, end, 0)
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(str[start:start+end]), &payload))
	assert.Equal(t, float64(IRSchemaVersion), payload["schemaVersion"], "contract version present")
	_, hasBare := payload["version"]
	assert.False(t, hasBare, "no bare row-version key")
}

func TestProjector_ElementTimeWindow_Projection(t *testing.T) {
	// P0-1: the time window rides into the builder payload as plain numbers
	// when set and is ABSENT when unset — legacy IRs must produce a payload
	// without the keys (back-compat: the builder's windowed path never
	// activates for old documents).
	ir := validIR()
	ir.Elements = []Element{
		{ID: "el_win", Type: ElementShape, Color: "#FF6A3D", X: 0, Y: 0, W: 10, H: 10,
			StartFrame: intp(45), EndFrame: intp(105)},
		{ID: "el_free", Type: ElementShape, Color: "#1E9E62", X: 20, Y: 0, W: 10, H: 10},
	}
	html, err := NewProjector(nil).HTML(t.Context(), ir, "")
	require.NoError(t, err)
	str := string(html)
	marker := "id=\"ploykit-ir\">"
	start := strings.Index(str, marker) + len(marker)
	end := strings.Index(str[start:], "</script>")
	require.GreaterOrEqual(t, end, 0)
	var payload struct {
		Elements []map[string]any `json:"elements"`
	}
	require.NoError(t, json.Unmarshal([]byte(str[start:start+end]), &payload))
	require.Len(t, payload.Elements, 2)
	assert.Equal(t, float64(45), payload.Elements[0]["startFrame"], "startFrame projected as number")
	assert.Equal(t, float64(105), payload.Elements[0]["endFrame"], "endFrame projected as number")
	_, has := payload.Elements[1]["startFrame"]
	assert.False(t, has, "no startFrame key on windowless element")
	_, has = payload.Elements[1]["endFrame"]
	assert.False(t, has, "no endFrame key on windowless element")
}

func TestProjector_FontFace_DataURI(t *testing.T) {
	// F-FNT-01: the projector inlines the Noto Sans SC subset @font-face as a
	// data URI — glyph rasterization must not depend on which system CJK fonts
	// the render machine happens to have. The document stays self-contained
	// (§4.4.5): the data URI IS the font, no network fetch.
	ir := validIR()
	ir.Elements = []Element{
		{ID: "title_1", Type: ElementText, Text: "标题", X: 0, Y: 0, W: 800, H: 120},
	}
	html, err := NewProjector(nil).HTML(t.Context(), ir, "")
	require.NoError(t, err)
	s := string(html)

	assert.Contains(t, s, "@font-face", "font-face rule present")
	assert.Contains(t, s, "font-family:'Noto Sans SC Sub'", "subset family declared")
	assert.Contains(t, s, `font-weight:400 900`, "variable weight range declared")
	assert.Contains(t, s, "format('woff2')", "woff2 format hint")

	// The data URI payload is present, non-empty, and decodes to woff2 bytes
	// (magic "wOF2", §WOFF2 spec: first 4 bytes of the table directory).
	const marker = "url(data:font/woff2;base64,"
	start := strings.Index(s, marker)
	require.GreaterOrEqual(t, start, 0, "data URI prefix present")
	start += len(marker)
	end := strings.Index(s[start:], ")")
	require.Greater(t, end, 0, "data URI terminated")
	b64 := s[start : start+end]
	require.NotEmpty(t, b64, "font payload non-empty")
	raw, derr := base64.StdEncoding.DecodeString(b64)
	require.NoError(t, derr, "payload is valid base64")
	require.Greater(t, len(raw), 1000, "payload is a real font, not a stub")
	require.Equal(t, "wOF2", string(raw[:4]), "woff2 magic bytes")

	// The subset family heads the CSS fallback chain so it wins over system
	// fonts even if a machine has real Noto/PingFang/YaHei installed.
	assert.Contains(t, s,
		`font-family: "Noto Sans SC Sub", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`,
		"subset family first in the fallback chain")

	// Zero-network invariant: the font never appears as an external URL. The
	// check targets the font-face rule, not the whole document — the vendored
	// gsap bundle legitimately contains license-banner URLs and SVG namespace
	// strings (constants, never fetched), and base64 payloads can contain
	// incidental "http" substrings.
	assert.NotContains(t, FontFaceCSS(), "http://", "font-face is data-URI only")
	assert.NotContains(t, FontFaceCSS(), "https://", "font-face is data-URI only")
	// Exactly one url() in the rule and it is the inline data URI.
	assert.Equal(t, 1, strings.Count(FontFaceCSS(), "url("), "single url() = the data URI")

	// FontSubset() exposes the same bytes the projection inlines.
	require.Equal(t, raw, FontSubset(), "embedded asset matches inlined payload")
}

func TestFontSubset_Woff2Magic(t *testing.T) {
	// The vendored asset itself: exists (go:embed compile-time guarantees the
	// path), non-trivial, and starts with the woff2 magic. Guards against the
	// file being replaced by an empty/corrupt artifact.
	raw := FontSubset()
	require.Greater(t, len(raw), 100_000, "subset has real content (expected ~217KB)")
	require.Equal(t, "wOF2", string(raw[:4]), "woff2 magic")
}
