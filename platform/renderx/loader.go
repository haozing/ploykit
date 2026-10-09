package renderx

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

type PathsFn func(ctx context.Context) ([]PagePath, error)

type LoaderFn func(ctx context.Context, p Params) (any, error)

type Registry struct {
	mu      sync.RWMutex
	paths   map[string]PathsFn
	loaders map[string]LoaderFn

	deps map[string][]string
}

func NewRegistry() *Registry {
	return &Registry{
		paths:   map[string]PathsFn{},
		loaders: map[string]LoaderFn{},
		deps:    map[string][]string{},
	}
}

var defaultRegistry = NewRegistry()

func RegisterPaths(pattern string, fn PathsFn) { defaultRegistry.RegisterPaths(pattern, fn) }

func RegisterLoader(pattern string, fn LoaderFn) { defaultRegistry.RegisterLoader(pattern, fn) }

func RegisterDep(pagePattern, dependsOnPattern string) {
	defaultRegistry.RegisterDep(pagePattern, dependsOnPattern)
}

func Reconcile(routes []RouteSpec) error { return defaultRegistry.Reconcile(routes) }

func ResetForTest() { defaultRegistry = NewRegistry() }

func AffectedPatterns(pattern string) []string { return defaultRegistry.AffectedPatterns(pattern) }

func (r *Registry) RegisterPaths(pattern string, fn PathsFn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mustValidPattern("Paths", pattern)
	if _, dup := r.paths[pattern]; dup {
		panic(fmt.Sprintf("renderx: Paths 重复注册 %q", pattern))
	}
	r.paths[pattern] = fn
}

func (r *Registry) RegisterLoader(pattern string, fn LoaderFn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mustValidPattern("Loader", pattern)
	if _, dup := r.loaders[pattern]; dup {
		panic(fmt.Sprintf("renderx: Loader 重复注册 %q", pattern))
	}
	r.loaders[pattern] = fn
}

func (r *Registry) RegisterDep(pagePattern, dependsOnPattern string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mustValidPattern("Dep(page)", pagePattern)
	r.mustValidPattern("Dep(dependsOn)", dependsOnPattern)
	if pagePattern == dependsOnPattern {
		panic(fmt.Sprintf("renderx: Dep 自环无意义： %q", pagePattern))
	}
	for _, p := range r.deps[dependsOnPattern] {
		if p == pagePattern {
			return
		}
	}
	r.deps[dependsOnPattern] = append(r.deps[dependsOnPattern], pagePattern)
}

func (r *Registry) LookupPaths(pattern string) (PathsFn, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	fn, ok := r.paths[pattern]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrPatternNotFound, pattern)
	}
	return fn, nil
}

func (r *Registry) LookupLoader(pattern string) (LoaderFn, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	fn, ok := r.loaders[pattern]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrPatternNotFound, pattern)
	}
	return fn, nil
}

func (r *Registry) AffectedPatterns(pattern string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []string{pattern}
	seen := map[string]bool{pattern: true}
	queue := []string{pattern}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, next := range r.deps[cur] {
			if seen[next] {
				continue
			}
			seen[next] = true
			out = append(out, next)
			queue = append(queue, next)
		}
	}
	return out
}

func (r *Registry) Reconcile(routes []RouteSpec) error {
	r.mu.RLock()
	defer r.mu.RUnlock()

	routeSet := make(map[string]RouteSpec, len(routes))
	for _, rt := range routes {
		routeSet[rt.Path] = rt
	}

	var errs []error

	for _, rt := range routes {
		if rt.Render != ModeStatic || !hasParams(rt.Path) {
			continue
		}
		if _, ok := r.paths[rt.Path]; !ok {
			errs = append(errs, fmt.Errorf(
				"%w: 路由 %q（pageId=%s）声明 static 且含参数，但未注册 Paths 枚举器；示例：\n"+
					"  renderx.Paths(%q, func(ctx context.Context) ([]renderx.PagePath, error) {\n"+
					"      return blog.AllSlugs(ctx, pool)\n"+
					"  })",
				ErrMissingPaths, rt.Path, rt.PageID, rt.Path))
		}
	}

	registered := map[string][]string{}
	for p := range r.paths {
		registered[p] = append(registered[p], "Paths")
	}
	for p := range r.loaders {
		registered[p] = append(registered[p], "Loader")
	}
	for dependsOn, pages := range r.deps {
		registered[dependsOn] = append(registered[dependsOn], "Dep(被依赖方)")
		for _, page := range pages {
			registered[page] = append(registered[page], "Dep(依赖方)")
		}
	}
	for _, p := range sortedKeys(registered) {
		if _, ok := routeSet[p]; !ok {
			errs = append(errs, fmt.Errorf(
				"%w: 注册键 %q（来源： %s）与路由表任何 path 都不逐字符相等；模式以 routes.tsx 声明原文为唯一规范，示例：\n"+
					"  renderx.Loader(\"/blog/:slug\", func(ctx context.Context, p renderx.Params) (any, error) {\n"+
					"      return blog.BySlug(ctx, pool, p[\"slug\"])\n"+
					"  })\n"+
					"路由表现有 path： %v",
				ErrPatternMismatch, p, strings.Join(registered[p], ", "), routePaths(routes)))
		}
	}
	return errors.Join(errs...)
}

func Match(pattern, path string) (Params, bool) {
	pSegs := strings.Split(pattern, "/")
	sSegs := strings.Split(path, "/")
	if len(pSegs) != len(sSegs) {
		return nil, false
	}
	var params Params
	for i, ps := range pSegs {
		ss := sSegs[i]
		if len(ps) > 1 && ps[0] == ':' {
			if ss == "" {
				return nil, false
			}
			if params == nil {
				params = Params{}
			}
			params[ps[1:]] = ss
			continue
		}
		if ps != ss {
			return nil, false
		}
	}
	return params, true
}

func ValidParamValue(v string) bool {
	if v == "" || len(v) > 256 {
		return false
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func ValidateParams(p Params) error {
	for k, v := range p {
		if !ValidParamValue(v) {
			return fmt.Errorf("%w: %s=%q", ErrInvalidParam, k, v)
		}
	}
	return nil
}

func hasParams(pattern string) bool {
	for _, seg := range strings.Split(pattern, "/") {
		if len(seg) > 1 && seg[0] == ':' {
			return true
		}
	}
	return false
}

func (r *Registry) mustValidPattern(where, pattern string) {
	if !validPattern(pattern) {
		panic(fmt.Sprintf("renderx: %s 非法模式 %q（:param 语法，形如 /blog/:slug）", where, pattern))
	}
}

func validPattern(pattern string) bool {
	if pattern == "/" {
		return true
	}
	if !strings.HasPrefix(pattern, "/") {
		return false
	}
	for _, seg := range strings.Split(pattern[1:], "/") {
		switch {
		case seg == "":
			return false
		case strings.HasPrefix(seg, ":"):
			if !isWordName(seg[1:]) {
				return false
			}
		case strings.Contains(seg, ":"):
			return false
		}
	}
	return true
}

func isWordName(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_':
		default:
			return false
		}
	}
	return true
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func routePaths(routes []RouteSpec) []string {
	out := make([]string, 0, len(routes))
	for _, rt := range routes {
		out = append(out, rt.Path)
	}
	sort.Strings(out)
	return out
}
