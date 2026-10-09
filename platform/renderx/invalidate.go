package renderx

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync/atomic"
	"time"
)

func ExpandPath(pattern string, params Params) (string, bool) {
	segs := strings.Split(pattern, "/")
	out := make([]string, len(segs))
	for i, s := range segs {
		if strings.HasPrefix(s, ":") {
			v, ok := params[s[1:]]
			if !ok || !ValidParamValue(v) {
				return "", false
			}
			out[i] = v
			continue
		}
		out[i] = s
	}
	return strings.Join(out, "/"), true
}

func keyToPath(key string) string {
	if key == "index.html" {
		return "/"
	}
	return "/" + key
}

const defaultRefreshTimeout = 30 * time.Second

type Service struct {
	Cache    *LayeredCache
	Renderer Renderer
	Routes   []RouteSpec
	BuildID  string
	Assets   ViteAssets
	Lang     string
	Registry *Registry

	Warn func(format string, args ...any)

	RefreshTimeout time.Duration
}

func (s *Service) registry() *Registry {
	if s.Registry != nil {
		return s.Registry
	}
	return defaultRegistry
}

func (s *Service) warnf(format string, args ...any) {
	if s.Warn != nil {
		s.Warn(format, args...)
		return
	}
	log.Printf(format, args...)
}

func (s *Service) Invalidate(ctx context.Context, pattern string, params Params) error {
	if s.Cache == nil {
		return errors.New("renderx: Service 未配置 Cache")
	}
	for _, pat := range s.registry().AffectedPatterns(pattern) {
		if err := s.invalidatePattern(ctx, pat, params); err != nil {
			return fmt.Errorf("renderx: 失效 %q（源于 %q）: %w", pat, pattern, err)
		}
	}
	return nil
}

func (s *Service) invalidatePattern(ctx context.Context, pattern string, params Params) error {
	if !hasParams(pattern) {
		return s.Cache.Delete(ctx, pattern)
	}
	if loc, ok := ExpandPath(pattern, params); ok {
		return s.Cache.Delete(ctx, loc)
	}
	_, err := s.Cache.EvictMatching(ctx, func(key string) bool {
		_, mok := Match(pattern, keyToPath(key))
		return mok
	})
	return err
}

func (s *Service) Refresh(ctx context.Context, pattern string, params Params) error {
	if err := s.Invalidate(ctx, pattern, params); err != nil {
		return err
	}
	paths, err := s.expandAffected(ctx, pattern, params)
	if err != nil {
		return err
	}
	if len(paths) == 0 {
		return nil
	}
	budget := s.RefreshTimeout
	if budget <= 0 {
		budget = defaultRefreshTimeout
	}
	go func() {
		bg, cancel := context.WithTimeout(context.Background(), budget)
		defer cancel()
		for _, p := range paths {
			s.rerender(bg, p)
		}
	}()
	return nil
}

func (s *Service) expandAffected(ctx context.Context, pattern string, params Params) ([]string, error) {
	var paths []string
	seen := map[string]bool{}
	add := func(p string) {
		if p != "" && !seen[p] {
			seen[p] = true
			paths = append(paths, p)
		}
	}
	for _, pat := range s.registry().AffectedPatterns(pattern) {
		if !hasParams(pat) {
			add(pat)
			continue
		}
		if loc, ok := ExpandPath(pat, params); ok {
			add(loc)
			continue
		}
		if fn, err := s.registry().LookupPaths(pat); err == nil {
			instances, err := fn(ctx)
			if err != nil {
				s.warnf("renderx: Refresh 枚举 %q 失败（跳过该来源）: %v", pat, err)
			} else {
				for _, pp := range instances {
					if loc, ok := ExpandPath(pat, pp.Params); ok {
						add(loc)
					}
				}
			}
		}
		for _, key := range s.Cache.Keys() {
			if loc := keyToPath(key); !seen[loc] {
				if _, mok := Match(pat, loc); mok {
					add(loc)
				}
			}
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func (s *Service) rerender(ctx context.Context, path string) {
	rt, params, ok := matchStatic(staticRoutes(s.Routes), path)
	if !ok {
		s.warnf("renderx: Refresh 跳过 %s（不在 static 路由表）", path)
		return
	}
	props, err := propsForRoute(ctx, s.registry(), rt.Path, params)
	if err != nil {
		s.warnf("renderx: Refresh 取数 %s 失败: %v", path, err)
		return
	}
	ent, err := renderPage(ctx, s.Renderer, rt.PageID, path, props, s.Lang, s.Assets)
	if err != nil {
		s.warnf("renderx: Refresh 重渲染 %s 失败: %v", path, err)
		return
	}
	ent.BuildID = s.BuildID
	if err := s.Cache.Put(ctx, path, ent); err != nil {
		s.warnf("renderx: Refresh 写缓存 %s 失败: %v", path, err)
	}
}

var globalService atomic.Pointer[Service]

func RegisterService(s *Service) { globalService.Store(s) }

func Invalidate(ctx context.Context, pattern string, params Params) error {
	s := globalService.Load()
	if s == nil {
		return errors.New("renderx: 全局服务未注册（先 Handler 挂载或 RegisterService）")
	}
	return s.Invalidate(ctx, pattern, params)
}

func Refresh(ctx context.Context, pattern string, params Params) error {
	s := globalService.Load()
	if s == nil {
		return errors.New("renderx: 全局服务未注册（先 Handler 挂载或 RegisterService）")
	}
	return s.Refresh(ctx, pattern, params)
}
