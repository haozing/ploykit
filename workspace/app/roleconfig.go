package app

import (
	"context"
	"sort"
	"strings"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
)

// RoleConfig is one row of the workspace role-permission matrix: the role's
// effective permission set plus whether it comes from an override row (an
// override REPLACES the built-in set — not a merge) and what the built-in
// default is.
type RoleConfig struct {
	Role       string             `json:"role"`
	Perms      []authz.Permission `json:"perms"`
	Overridden bool               `json:"overridden"`
	Defaults   []authz.Permission `json:"defaults"`
}

// configurableRoles are the roles whose permission sets a workspace may
// override. owner is immutable by design: an editable owner set invites
// lockout, and owner always carries roles:manage so the mistake stays
// recoverable.
var configurableRoles = map[string]struct{}{
	authz.RoleAdmin:   {},
	authz.RoleMember:  {},
}

func roleConfigurable(role string) bool {
	_, ok := configurableRoles[role]
	return ok
}

// ListRoleConfigs returns the full matrix (defaults, overrides, effective
// sets) plus the permission vocabulary for the management UI.
func (s *WorkspaceService) ListRoleConfigs(ctx context.Context, actor *webx.Principal, wsID string) ([]RoleConfig, []authz.Permission, error) {
	if _, ok := s.principalIn(ctx, actor, wsID); !ok {
		return nil, nil, webx.NewForbidden("not a workspace member")
	}
	overrides, err := s.repo.ListRoleOverrides(ctx, wsID)
	if err != nil {
		return nil, nil, err
	}
	roles := []string{authz.RoleAdmin, authz.RoleMember}
	out := make([]RoleConfig, 0, len(roles))
	for _, role := range roles {
		defaults := s.authz.BuiltinPerms(role)
		effective, overridden := defaults, false
		if perms, ok := overrides[role]; ok {
			effective, overridden = normalizePerms(perms), true
		}
		out = append(out, RoleConfig{Role: role, Perms: effective, Overridden: overridden, Defaults: defaults})
	}
	return out, s.authz.Catalog().List(), nil
}

// SetRolePerms writes a role override. The write boundary IS the drift
// guard (ADR 0012): every permission must exist in the code-registered
// catalog — UI-edited data cannot drift from the vocabulary because unknown
// permissions are rejected fail-closed at write time.
func (s *WorkspaceService) SetRolePerms(ctx context.Context, actor *webx.Principal, wsID, role string, perms []authz.Permission) (*RoleConfig, error) {
	p, ok := s.principalIn(ctx, actor, wsID)
	if !ok {
		return nil, webx.NewForbidden("not a workspace member")
	}
	if !roleConfigurable(role) {
		return nil, webx.NewValidation("role is not configurable (owner permissions are immutable)")
	}
	catalog := s.authz.Catalog()
	var unknown []string
	for _, perm := range perms {
		if !catalog.Has(perm) {
			unknown = append(unknown, string(perm))
		}
	}
	if len(unknown) > 0 {
		return nil, webx.NewValidation("unknown permissions (not in the registered catalog): " + strings.Join(unknown, ", "))
	}
	normalized := normalizePerms(perms)
	if err := s.repo.UpsertRolePerms(ctx, wsID, role, normalized, s.now()); err != nil {
		return nil, err
	}
	s.authz.InvalidateCache(wsID)
	s.audit(ctx, &wsID, p, "role_perms.set", "workspace_role", wsID+":"+role,
		map[string]any{"role": role, "perms": normalized})
	return &RoleConfig{Role: role, Perms: normalized, Overridden: true, Defaults: s.authz.BuiltinPerms(role)}, nil
}

// ResetRolePerms removes the override row so the role falls back to its
// built-in set. Idempotent: resetting a role without an override succeeds.
func (s *WorkspaceService) ResetRolePerms(ctx context.Context, actor *webx.Principal, wsID, role string) error {
	p, ok := s.principalIn(ctx, actor, wsID)
	if !ok {
		return webx.NewForbidden("not a workspace member")
	}
	if !roleConfigurable(role) {
		return webx.NewValidation("role is not configurable (owner permissions are immutable)")
	}
	if err := s.repo.DeleteRolePerms(ctx, wsID, role); err != nil {
		return err
	}
	s.authz.InvalidateCache(wsID)
	s.audit(ctx, &wsID, p, "role_perms.reset", "workspace_role", wsID+":"+role,
		map[string]any{"role": role})
	return nil
}

// normalizePerms dedupes and sorts — deterministic storage, readable audit
// trails, stable UI diffs.
func normalizePerms(perms []authz.Permission) []authz.Permission {
	seen := make(map[authz.Permission]struct{}, len(perms))
	out := make([]authz.Permission, 0, len(perms))
	for _, p := range perms {
		if _, dup := seen[p]; dup {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
