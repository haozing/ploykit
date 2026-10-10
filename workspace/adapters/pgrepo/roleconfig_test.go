package pgrepo

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authz"
	authzpg "github.com/haozing/ploykit/authz/adapters/pgrepo"
)

// Round-trips the role-config write side (workspace pgrepo) against the
// read side the authorizer actually uses (authz pgrepo PermsFor) — the two
// adapters over one table must agree (migration 026).
func TestRoleConfig_WriteReadRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := New(pool)
	reader := authzpg.New(pool)

	uid, email := seedUser(t, pool)
	ws, err := repo.CreateWorkspaceWithOwner(ctx, "roles-"+uid[:8], "Roles WS", uid, time.Now().UTC())
	require.NoError(t, err)
	_ = email

	perms := []authz.Permission{"billing:manage", "workspace:read"}
	require.NoError(t, repo.UpsertRolePerms(ctx, ws.ID, authz.RoleMember, perms, time.Now().UTC()))

	// the authorizer's provider sees the override
	got, err := reader.PermsFor(ctx, authz.RoleKey{WorkspaceID: ws.ID, Role: authz.RoleMember})
	require.NoError(t, err)
	assert.ElementsMatch(t, perms, got)

	// the management listing sees it keyed by role
	overrides, err := repo.ListRoleOverrides(ctx, ws.ID)
	require.NoError(t, err)
	assert.Equal(t, perms, overrides[authz.RoleMember])

	// upsert replaces (not merges)
	require.NoError(t, repo.UpsertRolePerms(ctx, ws.ID, authz.RoleMember,
		[]authz.Permission{"usage:read"}, time.Now().UTC()))
	overrides, err = repo.ListRoleOverrides(ctx, ws.ID)
	require.NoError(t, err)
	assert.Equal(t, []authz.Permission{"usage:read"}, overrides[authz.RoleMember], "覆盖必须整体替换")

	// delete removes the override → PermsFor back to nil (builtin defaults)
	require.NoError(t, repo.DeleteRolePerms(ctx, ws.ID, authz.RoleMember))
	got, err = reader.PermsFor(ctx, authz.RoleKey{WorkspaceID: ws.ID, Role: authz.RoleMember})
	require.NoError(t, err)
	assert.Nil(t, got, "删除覆盖后读侧应回到 nil（评估器走内置默认）")

	overrides, err = repo.ListRoleOverrides(ctx, ws.ID)
	require.NoError(t, err)
	assert.NotContains(t, overrides, authz.RoleMember)
}
