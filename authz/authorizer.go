package authz

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

type RoleKey struct {
	WorkspaceID string
	ProjectID   string
	Role        string
}

type Provider interface {
	PermsFor(ctx context.Context, key RoleKey) ([]Permission, error)
}

type Authorizer struct {
	catalog  *Catalog
	builtin  *RoleSet
	provider Provider
	log      *slog.Logger

	cacheTTL time.Duration
	mu       sync.RWMutex
	cache    map[string]cacheEntry
}

const negCacheTTL = 5 * time.Second

type cacheEntry struct {
	perms     []Permission
	neg       bool
	expiredAt time.Time
}

type Option func(*Authorizer)

func WithProvider(p Provider) Option { return func(a *Authorizer) { a.provider = p } }

func WithCacheTTL(d time.Duration) Option { return func(a *Authorizer) { a.cacheTTL = d } }

func WithLogger(log *slog.Logger) Option { return func(a *Authorizer) { a.log = log } }

func New(catalog *Catalog, builtin *RoleSet, opts ...Option) *Authorizer {
	if catalog == nil {
		catalog = DefaultCatalog()
	}
	if builtin == nil {
		builtin = DefaultRoles()
	}
	a := &Authorizer{
		catalog:  catalog,
		builtin:  builtin,
		cacheTTL: 30 * time.Second,
		cache:    map[string]cacheEntry{},
		log:      slog.Default(),
	}
	for _, opt := range opts {
		opt(a)
	}
	return a
}

func (a *Authorizer) Catalog() *Catalog { return a.catalog }

// BuiltinPerms returns the built-in (non-overridden) permission set of a
// role, sorted — used by role-config management to show defaults.
func (a *Authorizer) BuiltinPerms(role string) []Permission { return a.builtin.Perms(role) }

func (a *Authorizer) Can(p *webx.Principal, perm Permission) bool {
	return a.CanIn(context.Background(), p, perm)
}

func (a *Authorizer) CanIn(ctx context.Context, p *webx.Principal, perm Permission) bool {
	if p == nil || p.WorkspaceID == "" {
		return false
	}
	if !p.Scope.AllowsWorkspace(p.WorkspaceID) || !p.Scope.AllowsPermission(string(perm)) {
		return false
	}
	if p.IsPlatformAdmin {
		return true
	}
	key := RoleKey{WorkspaceID: p.WorkspaceID, Role: p.Role}
	if p.Project != nil {
		key.ProjectID = p.Project.ID
		key.Role = p.Project.Role
	}

	if a.provider != nil {
		perms, ok := a.loadCustom(ctx, key)
		if ok {
			rs := NewRoleSet().Set(key.Role, perms...)
			return rs.has(key.Role, perm)
		}
	}
	return a.builtin.has(key.Role, perm)
}

func (a *Authorizer) CanOwn(p *webx.Principal, base Permission, isOwn bool) bool {
	return a.CanOwnIn(context.Background(), p, base, isOwn)
}

func (a *Authorizer) CanOwnIn(ctx context.Context, p *webx.Principal, base Permission, isOwn bool) bool {
	if a.CanIn(ctx, p, base) {
		return true
	}
	if !isOwn {
		return false
	}
	return a.CanIn(ctx, p, base+"_own")
}

func (a *Authorizer) InvalidateCache(workspaceID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if workspaceID == "" {
		a.cache = map[string]cacheEntry{}
		return
	}
	for k := range a.cache {
		if ws, _, ok := strings.Cut(k, "\x00"); ok && ws == workspaceID {
			delete(a.cache, k)
		}
	}
}

func (a *Authorizer) loadCustom(ctx context.Context, key RoleKey) ([]Permission, bool) {
	k := key.WorkspaceID + "\x00" + key.ProjectID + "\x00" + key.Role
	a.mu.RLock()
	if e, ok := a.cache[k]; ok && time.Now().Before(e.expiredAt) {
		a.mu.RUnlock()
		if e.neg {
			return nil, false
		}
		return e.perms, true
	}
	a.mu.RUnlock()

	perms, err := a.provider.PermsFor(ctx, key)
	if err != nil {
		if a.log != nil {
			a.log.Warn("authz: custom role lookup failed, falling back to builtin",
				"workspace", key.WorkspaceID, "project", key.ProjectID, "role", key.Role, "err", err)
		}
		return nil, false
	}
	if perms == nil {

		if a.cacheTTL > 0 {
			ttl := min(negCacheTTL, a.cacheTTL)
			a.mu.Lock()
			a.cache[k] = cacheEntry{neg: true, expiredAt: time.Now().Add(ttl)}
			a.mu.Unlock()
		}
		return nil, false
	}
	if a.cacheTTL > 0 {
		a.mu.Lock()
		a.cache[k] = cacheEntry{perms: perms, expiredAt: time.Now().Add(a.cacheTTL)}
		a.mu.Unlock()
	}
	return perms, true
}
