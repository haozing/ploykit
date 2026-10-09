package logx

import (
	"bytes"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeTTYWriter struct{ bytes.Buffer }

func (f *fakeTTYWriter) Stat() (os.FileInfo, error) { return fakeCharDev{}, nil }

type fakeCharDev struct{}

func (fakeCharDev) Name() string       { return "tty" }
func (fakeCharDev) Size() int64        { return 0 }
func (fakeCharDev) Mode() os.FileMode  { return os.ModeCharDevice | 0o600 }
func (fakeCharDev) ModTime() time.Time { return time.Time{} }
func (fakeCharDev) IsDir() bool        { return false }
func (fakeCharDev) Sys() any           { return nil }

func TestLogx_NonTTYMatchesTextHandlerGolden(t *testing.T) {
	got := &bytes.Buffer{}
	want := &bytes.Buffer{}

	opt := Options{Level: "debug", Writer: got}
	logger := New(opt)

	reference := slog.New(slog.NewTextHandler(want, &slog.HandlerOptions{
		Level: slog.LevelDebug,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey {
				if tv, ok := a.Value.Any().(time.Time); ok {
					a.Value = slog.StringValue(tv.UTC().Format(time.RFC3339Nano))
				}
			}
			return a
		},
	}))

	for _, l := range []*slog.Logger{logger, reference} {
		l.Log(nil, slog.LevelInfo, "hello", "component", "pg", "n", 42)
		l.Error("boom", "err", "x")
		l.Debug("detail")
	}

	strippedGot := stripTime(got.String())
	strippedWant := stripTime(want.String())
	assert.Equal(t, strippedWant, strippedGot)
	assert.NotEmpty(t, strippedGot)

	first := got.String()
	if idx := strings.IndexByte(first, '\n'); idx >= 0 {
		first = first[:idx]
	}
	const tp = "time="
	i := strings.Index(first, tp)
	require.GreaterOrEqual(t, i, 0, "text 行应以 time= 开头: %q", first)
	tv := strings.TrimPrefix(first[i:], tp)
	if j := strings.IndexByte(tv, ' '); j >= 0 {
		tv = tv[:j]
	}
	parsed, err := time.Parse(time.RFC3339Nano, tv)
	require.NoError(t, err, "time 值须满足 RFC3339Nano: %q", tv)
	assert.True(t, parsed.Equal(parsed.UTC()), "time 须归一 UTC（Z 结尾）: %q", tv)
	assert.True(t, strings.HasSuffix(tv, "Z"))
}

func stripTime(s string) string {
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		if idx := strings.Index(ln, "level="); idx >= 0 {
			lines[i] = ln[idx:]
		}
	}
	return strings.Join(lines, "\n")
}

func TestLogx_LevelColorTable(t *testing.T) {
	cases := []struct {
		level slog.Level
		want  string
	}{
		{slog.LevelDebug, "\x1b[35m"},
		{slog.LevelInfo, "\x1b[34m"},
		{slog.LevelWarn, "\x1b[33m"},
		{slog.LevelError, "\x1b[31m"},
		{slog.LevelDebug - 4, "\x1b[35m"},
		{slog.LevelError + 4, "\x1b[31m"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, levelColor(c.level), "level=%v", c.level)
	}
}

func TestLogx_IsTTY(t *testing.T) {
	assert.False(t, isTTY(&bytes.Buffer{}))
	assert.True(t, isTTY(&fakeTTYWriter{}))
	assert.False(t, isTTY(nopWriter{}))
}

type nopWriter struct{}

func (nopWriter) Write(p []byte) (int, error) { return len(p), nil }

func TestLogx_TTYPathColored(t *testing.T) {

	t.Setenv("NO_COLOR", "")
	t.Setenv("TERM", "xterm-256color")
	w := &fakeTTYWriter{}
	logger := New(Options{Writer: w})

	logger.Info("hello tint", "component", "pg")
	out := w.String()
	require.NotEmpty(t, out)

	assert.True(t, strings.HasPrefix(out, ansiDim), "time should start dimmed: %q", out)
	assert.Contains(t, out, ansiReset+" \x1b[34mINFO"+ansiReset+" hello tint", "level-colored then original-color messages")
	assert.Contains(t, out, ansiDim+"component"+ansiReset+"=pg", "attr key dimmed, value normal color")
	assert.True(t, strings.HasSuffix(out, "\n"))

	w2 := &fakeTTYWriter{}
	Component(New(Options{Writer: w2}), "outboxx").Warn("careful")
	assert.Contains(t, w2.String(), "\x1b[33mWARN"+ansiReset+" careful")
	assert.Contains(t, w2.String(), ansiDim+"component"+ansiReset+"=outboxx")
}
