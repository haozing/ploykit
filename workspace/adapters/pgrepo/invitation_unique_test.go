package pgrepo

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/workspace/app"
)

func TestCreateInvitation_DuplicatePending_DQ_DEF_4(t *testing.T) {
	pool := testPool(t)

	require.NoError(t, pgm.Up(context.Background(), pool, migrations.FS, "."))
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	expires := time.Now().UTC().Add(24 * time.Hour)

	_, err := repo.CreateInvitation(ctx, ws.ID, "dq4-seq@test.dev", "member", owner, expires)
	require.NoError(t, err)

	_, err = repo.CreateInvitation(ctx, ws.ID, "dq4-seq@test.dev", "admin", owner, expires)
	assert.ErrorIs(t, err, app.ErrDuplicate, "重复 pending 应映射 ErrDuplicate（服务层转 409）")

	require.NoError(t, repo.RevokeInvitation(ctx, ws.ID, mustFirstPendingInvitationID(t, repo, ws.ID), time.Now().UTC()))
	_, err = repo.CreateInvitation(ctx, ws.ID, "dq4-seq@test.dev", "member", owner, expires)
	assert.NoError(t, err, "revoked 后重发应放行")
}

func TestCreateInvitation_ConcurrentDuplicate_DQ_DEF_4(t *testing.T) {
	pool := testPool(t)
	require.NoError(t, pgm.Up(context.Background(), pool, migrations.FS, "."))
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)

	const n = 6
	expires := time.Now().UTC().Add(24 * time.Hour)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = repo.CreateInvitation(ctx, ws.ID, "dq4-race@test.dev", "member", owner, expires)
		}(i)
	}
	wg.Wait()

	okCount, dupCount := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			okCount++
		case errors.Is(err, app.ErrDuplicate):
			dupCount++
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	assert.Equal(t, 1, okCount, "并发邀请恰一条落库")
	assert.Equal(t, n-1, dupCount, "其余全部 ErrDuplicate（服务层转 409）")
	assert.Equal(t, 1, countRows(t, pool, "workspace_invitation", ws.ID))
}

func mustFirstPendingInvitationID(t *testing.T, repo *Repo, wsID string) string {
	t.Helper()
	invs, err := repo.ListInvitations(context.Background(), wsID, 1, 50)
	require.NoError(t, err)
	require.NotEmpty(t, invs.Items)
	return invs.Items[0].ID
}
