package storagex

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

type Object struct {
	Key         string `json:"key"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
}

type Store interface {
	Put(ctx context.Context, key, contentType string, r io.Reader) (Object, error)

	Open(ctx context.Context, key string) (io.ReadCloser, Object, error)

	Delete(ctx context.Context, key string) error

	DeleteMulti(ctx context.Context, keys ...string) error

	URL(key string) string

	Presign(ctx context.Context, key string, ttl time.Duration) (string, error)
}

func deleteMulti(ctx context.Context, keys []string, del func(ctx context.Context, key string) error) error {
	var errs []error
	for _, k := range keys {
		if err := del(ctx, k); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", k, err))
		}
	}
	return errors.Join(errs...)
}

func ValidKey(key string) bool {
	if key == "" || len(key) > 512 {
		return false
	}
	for _, seg := range splitKey(key) {
		if !validSegment(seg) {
			return false
		}
	}
	for i := 0; i < len(key); i++ {
		switch key[i] {
		case '\\', ':', '\x00':
			return false
		}
	}
	return key[0] != '/' && key[len(key)-1] != '/'
}

func validSegment(seg string) bool {
	if seg == "" || seg == "." || seg == ".." {
		return false
	}
	if seg != strings.TrimRight(seg, ". ") {
		return false
	}
	base := seg
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	return !windowsReserved[strings.ToUpper(base)]
}

var windowsReserved = func() map[string]bool {
	m := map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true}
	for i := 1; i <= 9; i++ {
		m[fmt.Sprintf("COM%d", i)] = true
		m[fmt.Sprintf("LPT%d", i)] = true
	}
	return m
}()

func splitKey(key string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(key); i++ {
		if i == len(key) || key[i] == '/' {
			out = append(out, key[start:i])
			start = i + 1
		}
	}
	return out
}

func escapeKey(key string) string {
	segs := splitKey(key)
	out := make([]string, len(segs))
	for i, s := range segs {
		out[i] = url.PathEscape(s)
	}
	return strings.Join(out, "/")
}

func dispositionFor(contentType string) string {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "svg") || strings.Contains(ct, "html") {
		return "attachment"
	}
	return "inline"
}
