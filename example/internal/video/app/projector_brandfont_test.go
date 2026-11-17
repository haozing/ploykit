package videoapp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/storagex"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Brand-font projection tests (2026-11-17): ir.fontAssets → data-URI
// @font-face in the projected document.

// fakeFontResolver serves a fixed 2-byte body for every key with
// ContentType font/woff2 (the projector does not parse the font — it only
// inlines bytes; Chrome's fonts.ready gate at load time is the real parse).
type fakeFontResolver struct{}

func (fakeFontResolver) URL(_ context.Context, key string) (string, error) {
	if !strings.HasPrefix(key, "video/") {
		return "", assert.AnError
	}
	return "data:font/woff2;base64," + base64.StdEncoding.EncodeToString([]byte{0x77, 0x4F}), nil
}

// storageFakeFontResolver mirrors DataURIResolver with a storagex-shaped
// loader (the render-path resolver shape).
func storageFakeFontResolver() DataURIResolver {
	return DataURIResolver{
		Loader: func(_ context.Context, _ string) (io.ReadCloser, storagex.Object, error) {
			return io.NopCloser(strings.NewReader("wOF2fake")),
				storagex.Object{ContentType: "font/woff2"}, nil
		},
	}
}

func TestProjector_BrandFont_DataURIFontFace(t *testing.T) {
	ir := validIR()
	ir.FontAssets = []FontAsset{
		{Key: "video/ws-1/assets/p1/aaa.woff2", Family: "My Brand", Weight: "800"},
		{Key: "video/ws-1/assets/p1/bbb.woff2", Family: "Second_Family"}, // weightless
	}
	require.NoError(t, Validate(ir))

	html, err := NewProjector(storageFakeFontResolver()).HTML(context.Background(), ir, "")
	require.NoError(t, err)
	s := string(html)

	// Both rules present, after the vendored subset rule, with the data URI
	// and (only when set) the font-weight axis.
	assert.Contains(t, s, "@font-face{font-family:'My Brand';src:url(data:font/woff2;base64,",
		"brand rule #1 inlined")
	assert.Contains(t, s, "format('woff2');font-style:normal;font-display:block;font-weight:800;}",
		"brand rule #1 carries its weight")
	assert.Contains(t, s, "@font-face{font-family:'Second_Family';src:url(data:font/woff2;base64,",
		"brand rule #2 inlined")
	// the weightless rule closes right after font-display:block (no
	// font-weight declaration); slice from its family to the next '}'.
	second := s[strings.Index(s, "'Second_Family'"):]
	second = second[:strings.Index(second, "}")]
	assert.NotContains(t, second, "font-weight", "weightless brand rule omits font-weight")

	// The brand block sits inside the <style> head (not the JSON payload).
	styleStart := strings.Index(s, "<style>")
	styleEnd := strings.Index(s, "</style>")
	brandAt := strings.Index(s, "@font-face{font-family:'My Brand'")
	require.GreaterOrEqual(t, styleStart, 0)
	require.Greater(t, brandAt, styleStart)
	assert.Less(t, brandAt, styleEnd, "brand @font-face lives in the style block")

	// Legacy-compat: the fontAssets key does NOT ride into the builder JSON
	// payload (the builder does not consume fonts; the CSS does).
	marker := "id=\"ploykit-ir\">"
	start := strings.Index(s, marker) + len(marker)
	end := strings.Index(s[start:], "</script>")
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(s[start:start+end]), &payload))
	_, has := payload["fontAssets"]
	assert.False(t, has, "fontAssets stays out of the builder payload (CSS-side only)")
}

func TestProjector_NoFontAssets_ByteIdenticalBlock(t *testing.T) {
	// An IR without fontAssets must produce no brand-font block: the
	// template's {{if}} guard keeps the output identical to the pre-2026-11-17
	// projection.
	ir := validIR()
	html, err := NewProjector(nil).HTML(context.Background(), ir, "")
	require.NoError(t, err)
	assert.NotContains(t, string(html), "My Brand")
	assert.Equal(t, 1, strings.Count(string(html), "@font-face"),
		"only the vendored subset rule when no brand fonts are registered")
}

func TestProjector_BrandFont_ResolverErrorPropagates(t *testing.T) {
	// A font key the resolver cannot serve fails the projection (fail-closed,
	// same as a broken image src — a missing font must not render a
	// "successful" document with fallback typography).
	ir := validIR()
	ir.FontAssets = []FontAsset{{Key: "video/ws-1/assets/p1/missing.woff2", Family: "Brand"}}
	require.NoError(t, Validate(ir))
	_, err := NewProjector(DataURIResolver{
		Loader: func(_ context.Context, _ string) (io.ReadCloser, storagex.Object, error) {
			return nil, storagex.Object{}, assert.AnError
		},
	}).HTML(context.Background(), ir, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Brand")
}
