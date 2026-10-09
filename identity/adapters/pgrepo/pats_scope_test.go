package pgrepo

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

const (
	wsA = "11111111-1111-1111-1111-111111111111"
	wsB = "22222222-2222-2222-2222-222222222222"
	wsC = "33333333-3333-3333-3333-333333333333"
)

func mintPAT(t *testing.T, repo *Repo, uid, name string, scope *webx.CredentialScope) (string, string) {
	t.Helper()
	token, hash, prefix, err := domain.MintPAT("")
	require.NoError(t, err)
	pat, err := repo.CreatePAT(context.Background(), uid, name, hash, prefix, nil, scope)
	require.NoError(t, err)
	return token, pat.ID
}

func TestPATScopeRoundTrip_C3(t *testing.T) {
	repo, closeDB := oauthTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid, _ := oauthTestUser(t, repo)

	scope := &webx.CredentialScope{WorkspaceIDs: []string{wsA, wsB}, Permissions: []string{"tasks:read", "billing:*"}}
	token, patID := mintPAT(t, repo, uid, "scoped", scope)

	p, err := repo.ResolvePAT(ctx, token, time.Now().UTC())
	require.NoError(t, err)
	require.NotNil(t, p)
	assert.Equal(t, webx.SourcePAT, p.Source)
	require.NotNil(t, p.Scope, "约束型 PAT 解析后 Scope 应非 nil")
	assert.Equal(t, []string{wsA, wsB}, p.Scope.WorkspaceIDs)
	assert.Equal(t, []string{"tasks:read", "billing:*"}, p.Scope.Permissions)
	assert.True(t, p.Scope.AllowsWorkspace(wsA), "子集内工作区放行")
	assert.False(t, p.Scope.AllowsWorkspace(wsC), "子集外工作区拒绝")
	assert.True(t, p.Scope.AllowsPermission("billing:manage"), "域通配子集命中")
	assert.False(t, p.Scope.AllowsPermission("webhooks:manage"), "子集外权限拒绝")

	pats, err := repo.ListPATs(ctx, uid)
	require.NoError(t, err)
	for _, x := range pats {
		if x.ID == patID {
			require.NotNil(t, x.Scope, "ListPATs 应带回约束")
			assert.Equal(t, scope.WorkspaceIDs, x.Scope.WorkspaceIDs)
			return
		}
	}
	t.Fatal("ListPATs 未找到新建 PAT")
}

func TestPATScopeUnconstrained_C3(t *testing.T) {
	repo, closeDB := oauthTestDB(t)
	defer closeDB()
	uid, _ := oauthTestUser(t, repo)
	token, _ := mintPAT(t, repo, uid, "plain", nil)

	p, err := repo.ResolvePAT(context.Background(), token, time.Now().UTC())
	require.NoError(t, err)
	require.NotNil(t, p)
	assert.Nil(t, p.Scope, "NULL 列应解析为 nil Scope（无约束）")
	assert.True(t, p.Scope.AllowsWorkspace(wsA), "nil Scope 恒放行")
	assert.True(t, p.Scope.AllowsPermission("webhooks:manage"), "nil Scope 恒放行")
}

func TestPATScopeEmptySubsetDenyAll_C3(t *testing.T) {
	repo, closeDB := oauthTestDB(t)
	defer closeDB()
	uid, _ := oauthTestUser(t, repo)
	token, _ := mintPAT(t, repo, uid, "deny-all-ws",
		&webx.CredentialScope{WorkspaceIDs: []string{}})

	p, err := repo.ResolvePAT(context.Background(), token, time.Now().UTC())
	require.NoError(t, err)
	require.NotNil(t, p)
	require.NotNil(t, p.Scope, "空集也是约束，Scope 应非 nil")
	require.NotNil(t, p.Scope.WorkspaceIDs, "'{}' 应读回非 nil 空切片")
	assert.Empty(t, p.Scope.WorkspaceIDs)
	assert.False(t, p.Scope.AllowsWorkspace(wsA), "工作区空集全拒")
	assert.Nil(t, p.Scope.Permissions, "未给的子集列应保持 NULL")
	assert.True(t, p.Scope.AllowsPermission("anything:do"), "权限未约束则放行")
}
