package renderx

import (
	"bytes"
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/haozing/ploykit/platform/storagex"

	"golang.org/x/sync/singleflight"
)

const (
	DefaultMemPages = 1024
	DefaultTTL      = time.Hour
)

type CacheEntry struct {
	HTML        []byte    `json:"html"`
	PropsSHA256 string    `json:"props_sha256"`
	BuiltAt     time.Time `json:"built_at"`
	BuildID     string    `json:"build_id"`
}

type CacheConfig struct {
	BuildID  string
	MemPages int
	TTL      time.Duration
	Disk     *storagex.LocalBackend
}

type LayeredCache struct {
	buildID string
	ttl     time.Duration
	mem     *memCache
	disk    *storagex.LocalBackend
	sf      singleflight.Group
}

func NewLayeredCache(cfg CacheConfig) (*LayeredCache, error) {
	if cfg.BuildID == "" {
		return nil, errors.New("renderx: CacheConfig.BuildID 不能为空（buildId 版本化是缓存正确性的前提）")
	}
	pages := cfg.MemPages
	if pages <= 0 {
		pages = DefaultMemPages
	}
	ttl := cfg.TTL
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	return &LayeredCache{
		buildID: cfg.BuildID,
		ttl:     ttl,
		mem:     newMemCache(pages),
		disk:    cfg.Disk,
	}, nil
}

const buildMarker = "_build.marker"

func cacheKey(path string) (string, error) {
	if path == "/" {
		return "index.html", nil
	}
	if !strings.HasPrefix(path, "/") || strings.HasSuffix(path, "/") || strings.Contains(path, "//") {
		return "", fmt.Errorf("%w: %q 不是规范化路径", ErrInvalidCacheKey, path)
	}
	for _, seg := range strings.Split(path[1:], "/") {
		if !ValidParamValue(seg) {
			return "", fmt.Errorf("%w: 路径段 %q 越出白名单 [a-zA-Z0-9-_]", ErrInvalidCacheKey, seg)
		}
	}
	return path[1:], nil
}

func (c *LayeredCache) Get(ctx context.Context, path string) (CacheEntry, bool) {
	key, err := cacheKey(path)
	if err != nil {
		return CacheEntry{}, false
	}
	if ent, ok := c.mem.get(key); ok {
		if !c.expired(ent) {
			return ent, true
		}
	}
	if c.disk == nil {
		return CacheEntry{}, false
	}
	rc, _, err := c.disk.Open(ctx, key)
	if err != nil {
		return CacheEntry{}, false
	}
	defer rc.Close()
	var ent CacheEntry
	if err := json.NewDecoder(rc).Decode(&ent); err != nil {
		_ = c.disk.Delete(ctx, key)
		return CacheEntry{}, false
	}
	if ent.BuildID != c.buildID || c.expired(ent) {
		return CacheEntry{}, false
	}
	c.mem.put(key, ent)
	return ent, true
}

func (c *LayeredCache) Put(ctx context.Context, path string, ent CacheEntry) error {
	key, err := cacheKey(path)
	if err != nil {
		return err
	}
	if ent.BuildID == "" {
		ent.BuildID = c.buildID
	}
	if ent.BuildID != c.buildID {
		return fmt.Errorf("%w: 条目 %s=%q，当前 %q", ErrBuildIDMismatch, path, ent.BuildID, c.buildID)
	}
	if ent.BuiltAt.IsZero() {
		ent.BuiltAt = time.Now()
	}
	c.mem.put(key, ent)
	if c.disk == nil {
		return nil
	}
	body, err := json.Marshal(ent)
	if err != nil {
		return err
	}
	_, err = c.disk.Put(ctx, key, "application/json", bytes.NewReader(body))
	return err
}

func (c *LayeredCache) GetOrLoad(ctx context.Context, path string, load func(context.Context) (CacheEntry, error)) (CacheEntry, error) {
	if _, err := cacheKey(path); err != nil {
		return CacheEntry{}, err
	}
	if ent, ok := c.Get(ctx, path); ok {
		return ent, nil
	}
	v, err, _ := c.sf.Do(path, func() (any, error) {

		ictx := context.WithoutCancel(ctx)
		if ent, ok := c.Get(ictx, path); ok {
			return ent, nil
		}
		ent, err := load(ictx)
		if err != nil {
			return CacheEntry{}, err
		}
		_ = c.Put(ictx, path, ent)
		return ent, nil
	})
	if err != nil {
		return CacheEntry{}, err
	}
	return v.(CacheEntry), nil
}

func (c *LayeredCache) Delete(ctx context.Context, paths ...string) error {
	var errs []error
	for _, p := range paths {
		key, err := cacheKey(p)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		c.mem.delete(key)
		if c.disk != nil {
			if err := c.disk.Delete(ctx, key); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", p, err))
			}
		}
	}
	return errors.Join(errs...)
}

func (c *LayeredCache) GetStale(ctx context.Context, path string) (CacheEntry, bool) {
	key, err := cacheKey(path)
	if err != nil {
		return CacheEntry{}, false
	}
	if ent, ok := c.mem.peek(key); ok && ent.BuildID == c.buildID {
		return ent, true
	}
	if c.disk == nil {
		return CacheEntry{}, false
	}
	rc, _, err := c.disk.Open(ctx, key)
	if err != nil {
		return CacheEntry{}, false
	}
	defer rc.Close()
	var ent CacheEntry
	if err := json.NewDecoder(rc).Decode(&ent); err != nil {
		return CacheEntry{}, false
	}
	if ent.BuildID != c.buildID {
		return CacheEntry{}, false
	}
	return ent, true
}

func (c *LayeredCache) Keys() []string {
	set := map[string]bool{}
	for _, k := range c.mem.keys() {
		set[k] = true
	}
	if disk, err := c.diskKeys(); err == nil {
		for _, k := range disk {
			set[k] = true
		}
	}
	return sortedKeys(set)
}

func (c *LayeredCache) EvictMatching(ctx context.Context, match func(key string) bool) (int, error) {
	var n int
	var errs []error
	for _, k := range c.Keys() {
		if !match(k) {
			continue
		}
		c.mem.delete(k)
		if c.disk != nil {
			if err := c.disk.Delete(ctx, k); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", k, err))
				continue
			}
		}
		n++
	}
	return n, errors.Join(errs...)
}

func (c *LayeredCache) diskRoot() string {
	if c.disk == nil {
		return ""
	}
	return c.disk.Root
}

func (c *LayeredCache) diskKeys() ([]string, error) {
	if c.disk == nil {
		return nil, nil
	}
	root := c.disk.Root
	var keys []string
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(root, p)
		if rerr != nil {
			return nil
		}
		key := filepath.ToSlash(rel)
		if strings.HasPrefix(key, "_") || strings.HasSuffix(key, ".meta.json") {
			return nil
		}
		keys = append(keys, key)
		return nil
	})
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	return keys, nil
}

func (c *LayeredCache) PurgeForeign(ctx context.Context, buildID string) error {
	if buildID != c.buildID {
		return fmt.Errorf("renderx: PurgeForeign 的 buildID %q 与缓存构造代号 %q 不一致（疑似清错代）", buildID, c.buildID)
	}
	c.mem.clear()
	if c.disk == nil {
		return nil
	}
	markerPath := filepath.Join(c.disk.Root, buildMarker)
	if data, err := os.ReadFile(markerPath); err == nil {
		if string(data) == buildID {
			return nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	if err := os.RemoveAll(c.disk.Root); err != nil {
		return err
	}
	nl, err := storagex.NewLocal(c.disk.Root)
	if err != nil {
		return err
	}
	c.disk = nl
	return os.WriteFile(markerPath, []byte(buildID), 0o644)
}

func (c *LayeredCache) expired(ent CacheEntry) bool {
	return time.Since(ent.BuiltAt) > c.ttl
}

func PropsSHA256(propsJSON []byte) string {
	sum := sha256.Sum256(propsJSON)
	return hex.EncodeToString(sum[:])
}

type memCache struct {
	mu    sync.Mutex
	max   int
	ll    *list.List
	items map[string]*list.Element
}

type memItem struct {
	key string
	ent CacheEntry
}

func newMemCache(max int) *memCache {
	return &memCache{max: max, ll: list.New(), items: make(map[string]*list.Element, max)}
}

func (m *memCache) get(key string) (CacheEntry, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	el, ok := m.items[key]
	if !ok {
		return CacheEntry{}, false
	}
	m.ll.MoveToFront(el)
	return el.Value.(memItem).ent, true
}

func (m *memCache) put(key string, ent CacheEntry) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if el, ok := m.items[key]; ok {
		el.Value = memItem{key, ent}
		m.ll.MoveToFront(el)
		return
	}
	m.items[key] = m.ll.PushFront(memItem{key, ent})
	for m.ll.Len() > m.max {
		oldest := m.ll.Back()
		if oldest == nil {
			break
		}
		m.ll.Remove(oldest)
		delete(m.items, oldest.Value.(memItem).key)
	}
}

func (m *memCache) delete(key string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if el, ok := m.items[key]; ok {
		m.ll.Remove(el)
		delete(m.items, key)
	}
}

func (m *memCache) peek(key string) (CacheEntry, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	el, ok := m.items[key]
	if !ok {
		return CacheEntry{}, false
	}
	return el.Value.(memItem).ent, true
}

func (m *memCache) keys() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.items))
	for k := range m.items {
		out = append(out, k)
	}
	return out
}

func (m *memCache) clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ll.Init()
	m.items = make(map[string]*list.Element, m.max)
}
