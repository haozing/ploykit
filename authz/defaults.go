package authz

func DefaultPerms() []Permission {
	return []Permission{

		"workspace:read", "workspace:update", "workspace:delete",

		"members:read", "members:invite", "members:write", "members:remove",
		"invites:read",

		"billing:read", "billing:manage",

		"webhooks:read", "webhooks:manage",

		"notifications:read",

		"audit:read",

		"usage:read",
	}
}

func DefaultCatalog() *Catalog { return NewCatalog(DefaultPerms()...) }

func DefaultRoles() *RoleSet {
	r := NewRoleSet()
	all := DefaultPerms()

	r.Set(RoleOwner, all...)

	admin := make([]Permission, 0, len(all))
	for _, p := range all {
		if p == "workspace:delete" {
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
