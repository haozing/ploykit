package logx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func redactHook(_ []string, a slog.Attr) slog.Attr {
	if a.Value.Kind() == slog.KindString {
		a.Value = slog.StringValue(strings.ReplaceAll(a.Value.String(), "secret", "[REDACTED]"))
	}
	return a
}

func TestLogx_ReplaceAttrAllFormats(t *testing.T) {
	for _, format := range []string{"json", "text", "tint"} {
		w := &bytes.Buffer{}
		New(Options{Writer: w, Format: format, ReplaceAttr: redactHook}).
			Info("boot", "dsn", "postgres://u:secret@h/db")
		out := w.String()
		assert.NotContains(t, out, "secret", "format=%s：敏感值必须被钩子替换", format)
		assert.Contains(t, out, "[REDACTED]", "format=%s：脱敏产物应出现", format)
	}
}

func TestLogx_ReplaceAttrCompositionKeepsTimeNorm(t *testing.T) {
	w := &bytes.Buffer{}
	New(Options{Writer: w, Format: "json", ReplaceAttr: redactHook}).Info("t")
	var rec map[string]any
	require.NoError(t, json.Unmarshal(w.Bytes(), &rec))
	tv, ok := rec["time"].(string)
	require.True(t, ok)
	_, err := time.Parse(time.RFC3339Nano, tv)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(tv, "Z"), "用户钩子不得覆盖时间归一: %q", tv)
}

type chunkWriter struct {
	mu     sync.Mutex
	buf    bytes.Buffer
	writes int
}

func (c *chunkWriter) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writes++

	half := len(p) / 2
	if half > 0 {
		if _, err := c.buf.Write(p[:half]); err != nil {
			return 0, err
		}
	}
	if _, err := c.buf.Write(p[half:]); err != nil {
		return 0, err
	}
	return len(p), nil
}

func TestLogx_TintConcurrentHandle(t *testing.T) {
	const goroutines, perG = 8, 50
	w := &chunkWriter{}
	logger := New(Options{Writer: w, Format: "tint", ReplaceAttr: redactHook})

	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < perG; i++ {
				logger.Info("concurrent", "g", g, "i", i, "v", "secret")
			}
		}(g)
	}
	wg.Wait()

	lines := strings.Split(strings.TrimSpace(w.buf.String()), "\n")
	require.Len(t, lines, goroutines*perG, "每条日志恰一行，无丢失无合并")
	for _, ln := range lines {
		assert.Contains(t, ln, "[REDACTED]", "每行都经过钩子")

		assert.True(t, strings.HasPrefix(ln, ansiDim), "行首完整: %q", ln)
		assert.True(t, strings.HasSuffix(ln, "v"+ansiReset+"=[REDACTED]"), "行尾完整（未撕裂）: %q", ln)
	}
}

func TestLogx_InvalidLevelPanics(t *testing.T) {
	require.PanicsWithValue(t,
		"logx: invalid level fatal: unknown level \"fatal\" (debug|info|warn|error)",
		func() { New(Options{Writer: &bytes.Buffer{}, Level: "fatal"}) })
}

func TestLogx_LevelFilterSuppresses(t *testing.T) {
	for _, tc := range []struct {
		level string
		wants []string
		hides []string
	}{
		{"warn", []string{"w-msg", "e-msg"}, []string{"d-msg", "i-msg"}},
		{"error", []string{"e-msg"}, []string{"d-msg", "i-msg", "w-msg"}},
		{"debug", []string{"d-msg", "i-msg", "w-msg", "e-msg"}, nil},
	} {
		w := &bytes.Buffer{}
		l := New(Options{Writer: w, Level: tc.level, Format: "text"})
		l.Debug("d-msg")
		l.Info("i-msg")
		l.Warn("w-msg")
		l.Error("e-msg")
		for _, want := range tc.wants {
			assert.Contains(t, w.String(), "msg="+want, "level=%s", tc.level)
		}
		for _, hide := range tc.hides {
			assert.NotContains(t, w.String(), "msg="+hide, "level=%s 应抑制 %s", tc.level, hide)
		}
	}
}

func TestLogx_ParseLevelAliases(t *testing.T) {
	ok := []struct {
		in   string
		want slog.Level
	}{
		{"debug", slog.LevelDebug},
		{" INFO ", slog.LevelInfo},
		{"Warning", slog.LevelWarn},
		{"WARN", slog.LevelWarn},
		{"Error", slog.LevelError},
	}
	for _, c := range ok {
		got, err := parseLevel(c.in)
		require.NoError(t, err, c.in)
		assert.Equal(t, c.want, got, c.in)
	}
	_, err := parseLevel("fatal")
	assert.Error(t, err)
}

func TestLogx_ParseFormatTable(t *testing.T) {
	for in, want := range map[string]string{
		"":       "",
		" auto ": "auto",
		"TINT":   "tint",
		"Text":   "text",
		"json":   "json",
	} {
		got, err := parseFormat(in)
		require.NoError(t, err, in)
		assert.Equal(t, want, got, in)
	}
	_, err := parseFormat("xml")
	assert.Error(t, err)
}

func TestLogx_TintWithGroupRendering(t *testing.T) {
	w := &fakeTTYWriter{}
	l := New(Options{Writer: w, Format: "tint"}).WithGroup("req")
	l.Info("grouped", "id", "r-1")
	out := w.String()
	assert.Contains(t, out, ansiDim+"req.id"+ansiReset+"=r-1", "组名应作为键前缀: %q", out)

	w2 := &fakeTTYWriter{}
	l2 := New(Options{Writer: w2, Format: "tint"}).WithGroup("outer")
	l2.Info("nested", slog.Group("g", "k", "v"))
	assert.Contains(t, w2.String(), ansiDim+"outer.g.k"+ansiReset+"=v", "嵌套组键以 . 连接: %q", w2.String())
}

func TestLogx_WantColorEnv(t *testing.T) {
	t.Run("NO_COLOR set disables color even on TTY", func(t *testing.T) {
		t.Setenv("NO_COLOR", "1")
		t.Setenv("TERM", "xterm")
		w := &fakeTTYWriter{}
		New(Options{Writer: w}).Info("m")
		assert.NotContains(t, w.String(), "\x1b[", "NO_COLOR 下 auto 不得走 tint")
	})
	t.Run("TERM=dumb disables color", func(t *testing.T) {
		t.Setenv("NO_COLOR", "")
		t.Setenv("TERM", "dumb")
		w := &fakeTTYWriter{}
		New(Options{Writer: w}).Info("m")
		assert.NotContains(t, w.String(), "\x1b[", "TERM=dumb 下 auto 不得走 tint")
	})
	t.Run("explicit tint is an explicit choice (ANSI kept)", func(t *testing.T) {
		t.Setenv("NO_COLOR", "1")
		t.Setenv("TERM", "dumb")
		w := &fakeTTYWriter{}
		New(Options{Writer: w, Format: "tint"}).Info("m")
		assert.Contains(t, w.String(), "\x1b[", "显式 tint 不受色彩环境变量影响")
	})
}
