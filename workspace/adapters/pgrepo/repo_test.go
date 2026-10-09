package pgrepo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/workspace/app"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func seedUser(t *testing.T, pool *pgxpool.Pool) (id, email string) {
	t.Helper()
	email = fmt.Sprintf("ws3-%s@test.local", uuid.NewString()[:12])
	err := pool.QueryRow(context.Background(),
		`INSERT INTO "user" (email, display_name) VALUES ($1, $2) RETURNING id`,
		email, "ws3 tester").Scan(&id)
	require.NoError(t, err)
	t.Cleanup(func() {

		_, _ = pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, id)
	})
	return id, email
}

func seedWorkspace(t *testing.T, repo *Repo, ownerID string) app.Workspace {
	t.Helper()
	slug := "ws3-" + uuid.NewString()[:8]
	ws, err := repo.CreateWorkspaceWithOwner(context.Background(), slug, "WS3 测试区", ownerID, time.Now().UTC())
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, ws.ID)
	})
	return ws
}

func countRows(t *testing.T, pool *pgxpool.Pool, table, wsID string) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		fmt.Sprintf(`SELECT count(*) FROM %s WHERE workspace_id = $1`, table), wsID).Scan(&n))
	return n
}

func TestRepo_RunInTxRollsBackOnError(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)

	boom := errors.New("boom")
	err := repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := repo.CreateWorkspaceWithOwnerTx(ctx, tx, "ws3-rb-"+uuid.NewString()[:8], "回滚区", owner, time.Now().UTC()); err != nil {
			return err
		}
		return boom
	})
	require.ErrorIs(t, err, boom)

	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM workspace w WHERE w.created_by = $1 AND w.slug LIKE 'ws3-rb-%'`, owner).Scan(&n))
	assert.Zero(t, n, "rolled-back workspace must not exist")
}

func TestRepo_CreateWorkspaceWithOwnerTxCommits(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)

	got, ok, err := repo.GetWorkspace(ctx, ws.ID)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, ws.Slug, got.Slug)
	m, ok, err := repo.GetMember(ctx, ws.ID, owner)
	require.NoError(t, err)
	assert.True(t, ok, "owner membership must exist")
	assert.Equal(t, "owner", m.Role)
}

func TestRepo_AcceptInvitationTxRollbackAndCommit(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	invitee, inviteeEmail := seedUser(t, pool)
	now := time.Now().UTC()

	inv, err := repo.CreateInvitation(ctx, ws.ID, inviteeEmail, "member", owner, now.Add(24*time.Hour))
	require.NoError(t, err)

	boom := errors.New("boom")
	err = repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := repo.AcceptInvitationTx(ctx, tx, inv.ID, invitee, inviteeEmail, now); err != nil {
			return err
		}
		return boom
	})
	require.ErrorIs(t, err, boom)
	pending, err := repo.HasPendingInvitation(ctx, ws.ID, inviteeEmail)
	require.NoError(t, err)
	assert.True(t, pending)
	_, ok, err := repo.GetMember(ctx, ws.ID, invitee)
	require.NoError(t, err)
	assert.False(t, ok)

	var gotWs app.Workspace
	err = repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		gotWs, err = repo.AcceptInvitationTx(ctx, tx, inv.ID, invitee, inviteeEmail, now)
		return err
	})
	require.NoError(t, err)
	assert.Equal(t, ws.ID, gotWs.ID)
	m, ok, err := repo.GetMember(ctx, ws.ID, invitee)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "member", m.Role)
	pending, err = repo.HasPendingInvitation(ctx, ws.ID, inviteeEmail)
	require.NoError(t, err)
	assert.False(t, pending)
}

func TestRepo_RedeemShareLinkTxRollbackAndCommit(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	joiner, _ := seedUser(t, pool)
	now := time.Now().UTC()

	codeHash := "ws3hash" + uuid.NewString()
	link, err := repo.CreateShareLink(ctx, ws.ID, codeHash, "ws3-prefix", "member", owner, 5, now.Add(24*time.Hour))
	require.NoError(t, err)

	boom := errors.New("boom")
	err = repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := repo.RedeemShareLinkTx(ctx, tx, codeHash, joiner, now); err != nil {
			return err
		}
		return boom
	})
	require.ErrorIs(t, err, boom)
	links, err := repo.ListShareLinks(ctx, ws.ID, 1, 50)
	require.NoError(t, err)
	require.Len(t, links.Items, 1)
	assert.Zero(t, links.Items[0].Uses, "rollback must not burn a use")

	var gotWs app.Workspace
	err = repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		gotWs, err = repo.RedeemShareLinkTx(ctx, tx, codeHash, joiner, now)
		return err
	})
	require.NoError(t, err)
	assert.Equal(t, ws.ID, gotWs.ID)
	m, ok, err := repo.GetMember(ctx, ws.ID, joiner)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "member", m.Role)
	links, err = repo.ListShareLinks(ctx, ws.ID, 1, 50)
	require.NoError(t, err)
	require.Len(t, links.Items, 1)
	assert.Equal(t, 1, links.Items[0].Uses)
	_ = link
}

func TestRepo_DeleteWorkspaceCascade(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	member, memberEmail := seedUser(t, pool)
	now := time.Now().UTC()

	_, err := repo.CreateInvitation(ctx, ws.ID, memberEmail, "member", owner, now.Add(24*time.Hour))
	require.NoError(t, err)
	inv, err := repo.ListInvitations(ctx, ws.ID, 1, 50)
	require.NoError(t, err)
	require.Len(t, inv.Items, 1)
	_, err = repo.AcceptInvitation(ctx, inv.Items[0].ID, member, memberEmail, now)
	require.NoError(t, err)
	_, thirdEmail := seedUser(t, pool)
	_, err = repo.CreateInvitation(ctx, ws.ID, thirdEmail, "member", owner, now.Add(24*time.Hour))
	require.NoError(t, err)
	_, err = repo.CreateShareLink(ctx, ws.ID, "ws3hash"+uuid.NewString(), "pfx", "member", owner, 5, now.Add(24*time.Hour))
	require.NoError(t, err)

	var tornDown bool
	err = repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := repo.DeleteWorkspaceCascade(ctx, tx, ws.ID); err != nil {
			return err
		}
		tornDown = true
		return nil
	})
	require.NoError(t, err)
	assert.True(t, tornDown)

	_, ok, err := repo.GetWorkspace(ctx, ws.ID)
	require.NoError(t, err)
	assert.False(t, ok, "workspace must be gone")
	assert.Zero(t, countRows(t, pool, "member", ws.ID))
	assert.Zero(t, countRows(t, pool, "workspace_invitation", ws.ID))
	assert.Zero(t, countRows(t, pool, "workspace_share_link", ws.ID))

	err = repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return repo.DeleteWorkspaceCascade(ctx, tx, ws.ID)
	})
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func TestRepo_SoftRemoveMemberRecordsRemovedBy_WA11(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	member, memberEmail := seedUser(t, pool)
	now := time.Now().UTC()

	inv, err := repo.CreateInvitation(ctx, ws.ID, memberEmail, "member", owner, now.Add(24*time.Hour))
	require.NoError(t, err)
	_, err = repo.AcceptInvitation(ctx, inv.ID, member, memberEmail, now)
	require.NoError(t, err)

	require.NoError(t, repo.SoftRemoveMember(ctx, ws.ID, member, owner, now))
	var removedBy *string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT removed_by FROM member WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NOT NULL`,
		ws.ID, member).Scan(&removedBy))
	require.NotNil(t, removedBy, "移除后 removed_by 应落值")
	assert.Equal(t, owner, *removedBy)

	inv2, err := repo.CreateInvitation(ctx, ws.ID, memberEmail, "member", owner, now.Add(24*time.Hour))
	require.NoError(t, err)
	_, err = repo.AcceptInvitation(ctx, inv2.ID, member, memberEmail, now)
	require.NoError(t, err)
	m, ok, err := repo.GetMember(ctx, ws.ID, member)
	require.NoError(t, err)
	require.True(t, ok, "重加后应是活跃成员")
	assert.Equal(t, "member", m.Role)
	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM member WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NULL`,
		ws.ID, member).Scan(&n))
	assert.Equal(t, 1, n, "活跃成员行应恰一条（uq_member_active）")
}

func TestRepo_ListPagination_WA8(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	now := time.Now().UTC()

	for i := 0; i < 2; i++ {
		uid, email := seedUser(t, pool)
		inv, err := repo.CreateInvitation(ctx, ws.ID, email, "member", owner, now.Add(24*time.Hour))
		require.NoError(t, err)
		_, err = repo.AcceptInvitation(ctx, inv.ID, uid, email, now)
		require.NoError(t, err)
	}
	pg, err := repo.ListMembers(ctx, ws.ID, 1, 2)
	require.NoError(t, err)
	require.Len(t, pg.Items, 2)
	assert.Equal(t, 3, pg.Total)
	assert.Equal(t, owner, pg.Items[0].UserID, "ORDER BY created_at ASC：owner 最先加入")
	pg, err = repo.ListMembers(ctx, ws.ID, 3, 2)
	require.NoError(t, err)
	assert.Empty(t, pg.Items, "第三页（越过尾页）应为空")
	assert.Equal(t, 3, pg.Total, "越界页 total 仍是全量（COUNT 与页数据分离）")
	pg, err = repo.ListMembers(ctx, ws.ID, 2, 1)
	require.NoError(t, err)
	require.Len(t, pg.Items, 1)
	assert.Equal(t, 3, pg.Total)

	for i := 0; i < 3; i++ {
		_, email := seedUser(t, pool)
		_, err := repo.CreateInvitation(ctx, ws.ID, email, "member", owner, now.Add(24*time.Hour))
		require.NoError(t, err)
	}
	pgInv, err := repo.ListInvitations(ctx, ws.ID, 1, 2)
	require.NoError(t, err)
	require.Len(t, pgInv.Items, 2)
	assert.Equal(t, 3, pgInv.Total)

	for i := 0; i < 3; i++ {
		_, err := repo.CreateShareLink(ctx, ws.ID, "wa8hash"+uuid.NewString(), "pfx", "member", owner, 5, now.Add(24*time.Hour))
		require.NoError(t, err)
	}
	pgLink, err := repo.ListShareLinks(ctx, ws.ID, 2, 2)
	require.NoError(t, err)
	require.Len(t, pgLink.Items, 1)
	assert.Equal(t, 3, pgLink.Total)
}

func TestRepo_FindWorkspaceIDBySlug(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)

	id, ok, err := repo.FindWorkspaceIDBySlug(ctx, ws.Slug)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, ws.ID, id)

	id, ok, err = repo.FindWorkspaceIDBySlug(ctx, "no-such-ws-slug")
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Empty(t, id)
}

func TestRepo_UpdateWorkspaceName(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)

	require.NoError(t, repo.UpdateWorkspaceName(ctx, ws.ID, "新名字", time.Now().UTC()))
	got, ok, err := repo.GetWorkspace(ctx, ws.ID)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "新名字", got.Name)

	err = repo.UpdateWorkspaceName(ctx, uuid.NewString(), "不存在", time.Now().UTC())
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func TestRepo_LastOwnerGuard_P2_8(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, ownerEmail := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	now := time.Now().UTC()

	err := repo.UpdateMemberRole(ctx, ws.ID, owner, "member", now)
	assert.ErrorIs(t, err, app.ErrLastOwner)

	err = repo.SoftRemoveMember(ctx, ws.ID, owner, owner, now)
	assert.ErrorIs(t, err, app.ErrLastOwner)

	m, ok, err := repo.GetMember(ctx, ws.ID, owner)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "owner", m.Role)

	second, secondEmail := seedUser(t, pool)
	inv, err := repo.CreateInvitation(ctx, ws.ID, secondEmail, "member", owner, now.Add(24*time.Hour))
	require.NoError(t, err)
	_, err = repo.AcceptInvitation(ctx, inv.ID, second, secondEmail, now)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE member SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NULL`, ws.ID, second)
	require.NoError(t, err)

	require.NoError(t, repo.UpdateMemberRole(ctx, ws.ID, owner, "member", now))

	err = repo.SoftRemoveMember(ctx, ws.ID, second, owner, now)
	assert.ErrorIs(t, err, app.ErrLastOwner)

	err = repo.SoftRemoveMember(ctx, ws.ID, owner, second, now)
	require.NoError(t, err)

	err = repo.UpdateMemberRole(ctx, ws.ID, uuid.NewString(), "member", now)
	assert.ErrorIs(t, err, app.ErrNotFound)
	err = repo.SoftRemoveMember(ctx, ws.ID, uuid.NewString(), owner, now)
	assert.ErrorIs(t, err, app.ErrNotFound)
	_ = ownerEmail
}

func TestRepo_RedeemShareLinkIdempotentForMember_P3_4(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	owner, _ := seedUser(t, pool)
	ws := seedWorkspace(t, repo, owner)
	joiner, joinerEmail := seedUser(t, pool)
	now := time.Now().UTC()

	codeHash := "ws3hash" + uuid.NewString()
	_, err := repo.CreateShareLink(ctx, ws.ID, codeHash, "ws3-prefix", "member", owner, 5, now.Add(24*time.Hour))
	require.NoError(t, err)

	_, err = repo.RedeemShareLink(ctx, codeHash, joiner, now)
	require.NoError(t, err)

	_, err = repo.RedeemShareLink(ctx, codeHash, joiner, now)
	require.NoError(t, err)
	var uses int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT uses FROM workspace_share_link WHERE code_hash = $1`, codeHash).Scan(&uses))
	assert.Equal(t, 1, uses, "重复兑换不应烧 uses")
	m, ok, err := repo.GetMember(ctx, ws.ID, joiner)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "member", m.Role)
	_ = joinerEmail
}
