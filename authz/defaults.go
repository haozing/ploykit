package authz

func DefaultPerms() []Permission {
	return []Permission{

		"workspace:read", "workspace:update", "workspace:delete",

		"members:read", "members:invite", "members:write", "members:remove",
		"invites:read",

		"roles:manage",

		"billing:read", "billing:manage",

		"webhooks:read", "webhooks:manage",

		"notifications:read",

		"audit:read",

		"usage:read",
	}
}

func DefaultCatalog() *Catalog { return NewCatalog(DefaultPerms()...) }

// adminDenied lists permissions the default admin role does NOT carry.
// workspace:delete is owner-only (destructive); roles:manage is owner-only
// too — an admin who could edit role permissions could self-escalate
// (grant admin workspace:delete or anything else), so governance of the
// permission matrix itself stays with the owner by default. Products can
// override via the workspace role-config surface.
var adminDenied = map[Permission]struct{}{
	"workspace:delete": {},
	"roles:manage":     {},
}

func DefaultRoles() *RoleSet {
	r := NewRoleSet()
	all := DefaultPerms()

	r.Set(RoleOwner, all...)

	admin := make([]Permission, 0, len(all))
	for _, p := range all {
		if _, denied := adminDenied[p]; denied {
			continue
		}
		admin = append(admin, p)
	}
	r.Set(RoleAdmin, admin...)

	r.Set(RoleMember,
		"workspace:read",
		"members:read",
		"billing:read",
		"webhooks:read",
		"notifications:read",
		"usage:read",
		"invites:read",
	)
	return r
}
