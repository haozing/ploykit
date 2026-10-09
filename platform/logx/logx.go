package logx

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

type Options struct {
	Level  string
	Writer io.Writer

	Format string

	ReplaceAttr func(groups []string, a slog.Attr) slog.Attr
}

func New(opt Options) *slog.Logger {
	w := opt.Writer
	if w == nil {
		w = os.Stdout
	}
	level := slog.LevelInfo
	if opt.Level != "" {
		var err error
		level, err = parseLevel(opt.Level)
		if err != nil {
			panic("logx: invalid level " + opt.Level + ": " + err.Error())
		}
	}
	format, err := parseFormat(opt.Format)
	if err != nil {
		panic("logx: invalid format " + opt.Format + ": " + err.Error())
	}
	replace := chainAttrHooks(opt.ReplaceAttr, utcTimeAttr)
	switch format {
	case "json":
		return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{
			Level:       level,
			ReplaceAttr: replace,
		}))
	case "tint":
		return slog.New(&tintHandler{w: w, level: level, replaceAttr: opt.ReplaceAttr})
	case "text":
		return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{
			Level:       level,
			ReplaceAttr: replace,
		}))
	case "", "auto":
		if wantColor(w) {
			return slog.New(&tintHandler{w: w, level: level, replaceAttr: opt.ReplaceAttr})
		}
		return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{
			Level:       level,
			ReplaceAttr: replace,
		}))
	default:
		panic("logx: invalid format " + opt.Format + " (tint|text|json)")
	}
}

func utcTimeAttr(_ []string, a slog.Attr) slog.Attr {
	if a.Key == slog.TimeKey {
		if t, ok := a.Value.Any().(time.Time); ok {
			a.Value = slog.StringValue(t.UTC().Format(time.RFC3339Nano))
		}
	}
	return a
}

func chainAttrHooks(user, builtin func([]string, slog.Attr) slog.Attr) func([]string, slog.Attr) slog.Attr {
	if user == nil {
		return builtin
	}
	return func(groups []string, a slog.Attr) slog.Attr {
		return builtin(groups, user(groups, a))
	}
}

func Component(l *slog.Logger, name string) *slog.Logger {
	return l.With(slog.String("component", name))
}

func parseLevel(s string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return 0, fmt.Errorf("unknown level %q (debug|info|warn|error)", s)
}

func parseFormat(s string) (string, error) {
	f := strings.ToLower(strings.TrimSpace(s))
	switch f {
	case "", "auto", "tint", "text", "json":
		return f, nil
	}
	return "", fmt.Errorf("unknown format %q (tint|text|json)", s)
}

func isTTY(w io.Writer) bool {
	f, ok := w.(interface{ Stat() (os.FileInfo, error) })
	if !ok {
		return false
	}
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

func wantColor(w io.Writer) bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	return isTTY(w)
}

const (
	ansiReset = "\x1b[0m"
	ansiDim   = "\x1b[2m"
)

func levelColor(l slog.Level) string {
	switch {
	case l < slog.LevelInfo:
		return "\x1b[35m"
	case l < slog.LevelWarn:
		return "\x1b[34m"
	case l < slog.LevelError:
		return "\x1b[33m"
	default:
		return "\x1b[31m"
	}
}

type tintHandler struct {
	w     io.Writer
	level slog.Level

	replaceAttr func([]string, slog.Attr) slog.Attr

	mu sync.Mutex

	groups []string
	prefix []string
}

func (h *tintHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= h.level }

func (h *tintHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	var b strings.Builder
	b.WriteString(ansiDim)
	b.WriteString(r.Time.UTC().Format(time.RFC3339Nano))
	b.WriteString(ansiReset)
	b.WriteByte(' ')
	b.WriteString(levelColor(r.Level))
	b.WriteString(r.Level.String())
	b.WriteString(ansiReset)
	b.WriteByte(' ')
	b.WriteString(r.Message)
	for _, kv := range h.prefix {
		b.WriteByte(' ')
		b.WriteString(kv)
	}
	r.Attrs(func(a slog.Attr) bool {
		h.appendAttr(&b, h.attr(a))
		return true
	})
	b.WriteByte('\n')
	_, err := io.WriteString(h.w, b.String())
	return err
}

func (h *tintHandler) attr(a slog.Attr) slog.Attr {
	if h.replaceAttr == nil {
		return a
	}
	return h.replaceAttr(h.groups, a)
}

func (h *tintHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}

	clone := &tintHandler{
		w:           h.w,
		level:       h.level,
		replaceAttr: h.replaceAttr,
		groups:      h.groups,
		prefix:      make([]string, len(h.prefix), len(h.prefix)+len(attrs)),
	}
	copy(clone.prefix, h.prefix)
	for _, a := range attrs {
		a = clone.attr(a)
		if a.Equal(slog.Attr{}) {
			continue
		}
		var b strings.Builder
		clone.appendAttr(&b, a)
		clone.prefix = append(clone.prefix, strings.TrimPrefix(b.String(), " "))
	}
	return clone
}

func (h *tintHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	clone := &tintHandler{
		w:           h.w,
		level:       h.level,
		replaceAttr: h.replaceAttr,
		groups:      append(append([]string{}, h.groups...), name),
		prefix:      append([]string{}, h.prefix...),
	}
	return clone
}

func (h *tintHandler) appendAttr(b *strings.Builder, a slog.Attr) {
	if a.Equal(slog.Attr{}) {
		return
	}
	if a.Value.Kind() == slog.KindGroup {
		groups := append(h.groups, a.Key)
		sub := &tintHandler{groups: groups, replaceAttr: h.replaceAttr}
		for _, ga := range a.Value.Group() {
			sub.appendAttr(b, sub.attr(ga))
		}
		return
	}
	key := a.Key
	if len(h.groups) > 0 {
		key = strings.Join(h.groups, ".") + "." + key
	}
	b.WriteByte(' ')
	b.WriteString(ansiDim)
	b.WriteString(key)
	b.WriteString(ansiReset)
	b.WriteByte('=')
	b.WriteString(a.Value.String())
}
