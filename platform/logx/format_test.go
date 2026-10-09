package logx

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogx_JSONFormat(t *testing.T) {
	w := &bytes.Buffer{}
	logger := New(Options{Writer: w, Format: "json"})

	logger.Info("hello json", "component", "webx", "n", 42)

	out := strings.TrimSpace(w.String())
	lines := strings.Split(out, "\n")
	require.Len(t, lines, 1, "one log call must produce exactly one JSON line")

	var rec map[string]any
	require.NoError(t, json.Unmarshal([]byte(lines[0]), &rec), "line must be valid JSON: %q", lines[0])

	tv, ok := rec["time"].(string)
	require.True(t, ok, "time must be a JSON string")
	_, err := time.Parse(time.RFC3339, tv)
	assert.NoError(t, err, "time must satisfy RFC3339: %q", tv)
	assert.True(t, strings.HasSuffix(tv, "Z"), "time must be normalized to UTC: %q", tv)

	assert.Equal(t, "INFO", rec["level"])
	assert.Equal(t, "hello json", rec["msg"])
	assert.Equal(t, "webx", rec["component"])
	assert.Equal(t, float64(42), rec["n"])
}

func TestLogx_ExplicitFormatText(t *testing.T) {
	w := &bytes.Buffer{}
	logger := New(Options{Writer: w, Format: "text"})

	logger.Warn("explicit-text", "k", "v")

	out := w.String()
	assert.Contains(t, out, "level=WARN")
	assert.Contains(t, out, "msg=explicit-text")
	assert.Contains(t, out, "k=v")
}

func TestLogx_ExplicitFormatTint(t *testing.T) {
	w := &fakeTTYWriter{}
	logger := New(Options{Writer: w, Format: "tint"})

	logger.Info("explicit tint")

	out := w.String()
	require.NotEmpty(t, out)
	assert.Contains(t, out, "explicit tint")
	assert.True(t, strings.HasPrefix(out, ansiDim), "explicit tint must keep the tint rendering")
}

func TestLogx_FormatAutoAlias(t *testing.T) {
	w := &bytes.Buffer{}
	logger := New(Options{Writer: w, Format: "auto"})

	logger.Info("auto-non-tty-text")

	out := w.String()
	assert.Contains(t, out, "msg=auto-non-tty-text")
	assert.NotContains(t, out, "{", "text handler shape, not json")
}

func TestLogx_InvalidFormatPanics(t *testing.T) {

	require.PanicsWithValue(t,
		"logx: invalid format xml: unknown format \"xml\" (tint|text|json)",
		func() { New(Options{Writer: &bytes.Buffer{}, Format: "xml"}) })
}

func TestLogx_FormatCaseAndSpaceTolerant(t *testing.T) {
	for _, f := range []string{"JSON", "  Json ", "\tjson\n"} {
		w := &bytes.Buffer{}
		New(Options{Writer: w, Format: f}).Info("cased")
		assert.Contains(t, w.String(), `"msg":"cased"`, "format %q 应解析为 json", f)
	}
}
