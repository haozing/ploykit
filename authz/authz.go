package authz

type Permission string

const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleMember = "member"
)

type Catalog struct {
	descs map[Permission]string
}

func NewCatalog(perms ...Permission) *Catalog {
	c := &Catalog{descs: make(map[Permission]string)}
	c.Register(perms...)
	return c
}

func (c *Catalog) Register(perms ...Permission) {
	for _, p := range perms {
		c.descs[p] = ""
	}
}

func (c *Catalog) RegisterWithDesc(p Permission, desc string) { c.descs[p] = desc }

func (c *Catalog) Has(p Permission) bool { _, ok := c.descs[p]; return ok }

func (c *Catalog) List() []Permission {
	out := make([]Permission, 0, len(c.descs))
	for p := range c.descs {
		out = append(out, p)
	}
	return out
}

type RoleSet struct {
	roles map[string]map[Permission]struct{}
}

func NewRoleSet() *RoleSet { return &RoleSet{roles: map[string]map[Permission]struct{}{}} }

func (r *RoleSet) Set(role string, perms ...Permission) *RoleSet {
	set := make(map[Permission]struct{}, len(perms))
	for _, p := range perms {
		set[p] = struct{}{}
	}
	r.roles[role] = set
	return r
}

func (r *RoleSet) Grant(role string, perms ...Permission) *RoleSet {
	set, ok := r.roles[role]
	if !ok {
		set = map[Permission]struct{}{}
		r.roles[role] = set
	}
	for _, p := range perms {
		set[p] = struct{}{}
	}
	return r
}

func (r *RoleSet) Revoke(role string, perms ...Permission) *RoleSet {
	if set, ok := r.roles[role]; ok {
		for _, p := range perms {
			delete(set, p)
		}
	}
	return r
}

func (r *RoleSet) Clone() *RoleSet {
	out := NewRoleSet()
	for role, set := range r.roles {
		ns := make(map[Permission]struct{}, len(set))
		for p := range set {
			ns[p] = struct{}{}
		}
		out.roles[role] = ns
	}
	return out
}

func (r *RoleSet) has(role string, perm Permission) bool {
	set, ok := r.roles[role]
	if !ok {
		return false
	}
	if _, ok := set[perm]; ok {
		return true
	}

	_, ok = set[Permission(domainOf(perm)+":*")]
	return ok
}

func domainOf(p Permission) string {
	for i := 0; i < len(p); i++ {
		if p[i] == ':' {
			return string(p[:i])
		}
	}
	return string(p)
}
