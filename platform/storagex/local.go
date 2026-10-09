package storagex

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type LocalBackend struct {
	Root string

	rootOnce sync.Once
	rootReal string
	rootErr  error
}

func NewLocal(root string) (*LocalBackend, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &LocalBackend{Root: root}, nil
}

type meta struct {
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	Disposition string `json:"disposition"`
	Filename    string `json:"filename,omitempty"`
}

func (l *LocalBackend) realRoot() (string, error) {
	l.rootOnce.Do(func() {
		real, err := filepath.EvalSymlinks(l.Root)
		if err != nil {
			l.rootErr = err
			return
		}
		l.rootReal, l.rootErr = filepath.Abs(real)
	})
	return l.rootReal, l.rootErr
}

func resolveExisting(p string) string {
	cur, tail := p, ""
	for {
		if real, err := filepath.EvalSymlinks(cur); err == nil {
			if tail == "" {
				return real
			}
			return filepath.Join(real, tail)
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return p
		}
		tail = filepath.Join(filepath.Base(cur), tail)
		cur = parent
	}
}

func (l *LocalBackend) path(key string) (string, error) {
	if !ValidKey(key) {
		return "", errors.New("storagex: invalid key")
	}
	p := filepath.Join(l.Root, filepath.FromSlash(key))

	rootAbs, err := filepath.Abs(l.Root)
	if err != nil {
		return "", err
	}
	pAbs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}

	if pAbs != rootAbs && !strings.HasPrefix(pAbs, rootAbs+string(os.PathSeparator)) {
		return "", errors.New("storagex: path escape rejected")
	}

	rootReal, err := l.realRoot()
	if err != nil {
		return "", err
	}
	resolved := resolveExisting(pAbs)
	if resolved != rootReal && !strings.HasPrefix(resolved, rootReal+string(os.PathSeparator)) {
		return "", errors.New("storagex: path escape rejected")
	}
	return pAbs, nil
}

func (l *LocalBackend) metaPath(key string) (string, error) {
	p, err := l.path(key)
	if err != nil {
		return "", err
	}
	return p + ".meta.json", nil
}

func (l *LocalBackend) Put(_ context.Context, key, contentType string, r io.Reader) (Object, error) {
	p, err := l.path(key)
	if err != nil {
		return Object{}, err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return Object{}, err
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return Object{}, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, h), r)
	if err != nil {
		tmp.Close()
		return Object{}, err
	}
	if err := tmp.Close(); err != nil {
		return Object{}, err
	}
	if err := os.Rename(tmpName, p); err != nil {
		return Object{}, err
	}
	m := meta{ContentType: contentType, Size: size, SHA256: hex.EncodeToString(h.Sum(nil)),
		Disposition: dispositionFor(contentType), Filename: filepath.Base(key)}
	mb, _ := json.Marshal(m)

	if err := writeFileAtomic(p+".meta.json", mb, 0o644); err != nil {
		return Object{}, err
	}
	return Object{Key: key, ContentType: contentType, Size: size, SHA256: m.SHA256}, nil
}

func writeFileAtomic(p string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(p), ".meta-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, p)
}

func (l *LocalBackend) Open(_ context.Context, key string) (io.ReadCloser, Object, error) {
	p, err := l.path(key)
	if err != nil {
		return nil, Object{}, err
	}
	mp := p + ".meta.json"
	mb, err := os.ReadFile(mp)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, Object{}, os.ErrNotExist
		}
		return nil, Object{}, err
	}
	var m meta
	if err := json.Unmarshal(mb, &m); err != nil {
		return nil, Object{}, err
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, Object{}, err
	}
	return f, Object{Key: key, ContentType: m.ContentType, Size: m.Size, SHA256: m.SHA256}, nil
}

func (l *LocalBackend) Delete(_ context.Context, key string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}

	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Remove(p + ".meta.json"); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (l *LocalBackend) DeleteMulti(ctx context.Context, keys ...string) error {
	return deleteMulti(ctx, keys, l.Delete)
}

func (l *LocalBackend) URL(key string) string { return "/uploads/" + escapeKey(key) }

func (l *LocalBackend) Presign(_ context.Context, key string, _ time.Duration) (string, error) {
	return l.URL(key), nil
}

func (l *LocalBackend) LoadMeta(key string) (meta, error) {
	mp, err := l.metaPath(key)
	if err != nil {
		return meta{}, err
	}
	mb, err := os.ReadFile(mp)
	if err != nil {
		return meta{}, err
	}
	var m meta
	return m, json.Unmarshal(mb, &m)
}
