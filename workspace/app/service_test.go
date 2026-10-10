package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace"
	"github.com/haozing/ploykit/workspace/domain"
)

type fake struct {
	Repo
	workspaces map[string]Workspace
	members    map[string]fakeMember
	invites    map[string]Invitation
	links      map[string]fakeLink
	linkWS     map[string]string
	calls      []string
	joinRole   string

	roleOverrides map[string][]authz.Permission

	userStatus       map[string]string
	boomAfterPromote bool
}

type fakeMember struct{ m Member }

type fakeLink struct{ l ShareLink }

func newFake() *fake {
	return &fake{
		workspaces:    map[string]Workspace{},
		members:       map[string]fakeMember{},
		invites:       map[string]Invitation{},
		links:         map[string]fakeLink{},
		linkWS:        map[string]string{},
		joinRole:      "member",
		roleOverrides: map[string][]authz.Permission{},
		userStatus:    map[string]string{},
	}
}

type fakeSnapshot struct {
	workspaces map[string]Workspace
	members    map[string]fakeMember
	invites    map[string]Invitation
	links      map[string]fakeLink
	linkWS     map[string]string
}

func (f *fake) snapshot() fakeSnapshot {
	s := fakeSnapshot{
		workspaces: map[string]Workspace{},
		members:    map[string]fakeMember{},
		invites:    map[string]Invitation{},
		links:      map[string]fakeLink{},
		linkWS:     map[string]string{},
	}
	for k, v := range f.workspaces {
		s.workspaces[k] = v
	}
	for k, v := range f.members {
		s.members[k] = v
	}
	for k, v := range f.invites {
		s.invites[k] = v
	}
	for k, v := range f.links {
		s.links[k] = v
	}
	for k, v := range f.linkWS {
		s.linkWS[k] = v
	}
	return s
}

func (f *fake) restore(s fakeSnapshot) {
	f.workspaces, f.members, f.invites, f.links, f.linkWS =
		s.workspaces, s.members, s.invites, s.links, s.linkWS
}

func (f *fake) record(call string) { f.calls = append(f.calls, call) }

func (f *fake) called(call string) bool {
	for _, c := range f.calls {
		if c == call {
			return true
		}
	}
	return false
}

func memberKeyOf(wsID, userID string) string { return wsID + "|" + userID }

type fakeTx struct {
	pgx.Tx
	f *fake
}

func (t *fakeTx) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return fakeRow{role: t.f.joinRole}
}

type fakeRow struct{ role string }

func (r fakeRow) Scan(dest ...any) error {
	if s, ok := dest[0].(*string); ok {
		*s = r.role
	}
	return nil
}

func (f *fake) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	snap := f.snapshot()
	if err := fn(ctx, &fakeTx{f: f}); err != nil {
		f.restore(snap)
		return err
	}
	return nil
}

func (f *fake) CountWorkspacesByUser(_ context.Context, userID string) (int, error) {
	seen := map[string]bool{}
	for k, fm := range f.members {
		if fm.m.UserID == userID {
			seen[splitKey(k)[0]] = true
		}
	}
	return len(seen), nil
}

func (f *fake) CountWorkspacesByUserForCreateTx(ctx context.Context, _ pgx.Tx, userID string) (int, error) {
	return f.CountWorkspacesByUser(ctx, userID)
}

func splitKey(k string) [2]string {
	for i := len(k) - 1; i >= 0; i-- {
		if k[i] == '|' {
			return [2]string{k[:i], k[i+1:]}
		}
	}
	return [2]string{k, ""}
}

func (f *fake) CreateWorkspaceWithOwnerTx(_ context.Context, _ pgx.Tx, slug, name, ownerUserID string, _ time.Time) (Workspace, error) {
	for _, ws := range f.workspaces {
		if ws.Slug == slug {
			return Workspace{}, ErrDuplicate
		}
	}
	ws := Workspace{ID: "ws-" + slug, Slug: slug, Name: name, PlanCode: "free", CreatedAt: time.Now().UTC()}
	f.workspaces[ws.ID] = ws
	f.members[memberKeyOf(ws.ID, ownerUserID)] = fakeMember{Member{UserID: ownerUserID, Role: "owner"}}
	return ws, nil
}

func (f *fake) CreateWorkspaceWithOwner(ctx context.Context, slug, name, ownerUserID string, now time.Time) (Workspace, error) {
	return f.CreateWorkspaceWithOwnerTx(ctx, nil, slug, name, ownerUserID, now)
}

func (f *fake) GetWorkspace(_ context.Context, id string) (Workspace, bool, error) {
	ws, ok := f.workspaces[id]
	return ws, ok, nil
}

func (f *fake) GetMember(_ context.Context, wsID, userID string) (Member, bool, error) {
	fm, ok := f.members[memberKeyOf(wsID, userID)]
	if !ok {
		return Member{}, false, nil
	}
	return fm.m, true, nil
}

func (f *fake) CountActiveOwners(_ context.Context, wsID string) (int, error) {
	n := 0
	for k, fm := range f.members {
		if splitKey(k)[0] == wsID && fm.m.Role == "owner" {
			n++
		}
	}
	return n, nil
}

func (f *fake) otherActiveOwners(wsID, userID string) int {
	n := 0
	for k, fm := range f.members {
		if splitKey(k)[0] == wsID && fm.m.Role == "owner" && fm.m.UserID != userID {
			n++
		}
	}
	return n
}

func (f *fake) SoftRemoveMember(_ context.Context, wsID, userID, removedBy string, _ time.Time) error {
	k := memberKeyOf(wsID, userID)
	fm, ok := f.members[k]
	if !ok {
		return ErrNotFound
	}

	if fm.m.Role == "owner" && f.otherActiveOwners(wsID, userID) == 0 {
		return ErrLastOwner
	}
	f.record("soft-remove:" + userID + ":by=" + removedBy)
	delete(f.members, k)
	return nil
}

func (f *fake) UpdateWorkspaceName(_ context.Context, id, name string, _ time.Time) error {
	ws, ok := f.workspaces[id]
	if !ok {
		return ErrNotFound
	}
	ws.Name = name
	f.workspaces[id] = ws
	f.record("update-name")
	return nil
}

func (f *fake) DeleteWorkspaceCascade(_ context.Context, _ pgx.Tx, wsID string) error {
	f.record("delete-cascade:" + wsID)
	if _, ok := f.workspaces[wsID]; !ok {
		return ErrNotFound
	}
	delete(f.workspaces, wsID)
	for k := range f.members {
		if splitKey(k)[0] == wsID {
			delete(f.members, k)
		}
	}
	return nil
}

func (f *fake) CreateInvitation(_ context.Context, wsID, email, role, _ string, _ time.Time) (Invitation, error) {
	inv := Invitation{ID: "inv-" + email, WorkspaceID: wsID, Email: email, Role: role, Status: "pending"}
	f.invites[inv.ID] = inv
	return inv, nil
}

func (f *fake) HasPendingInvitation(_ context.Context, wsID, email string) (bool, error) {
	for _, inv := range f.invites {
		if inv.WorkspaceID == wsID && inv.Email == email && inv.Status == "pending" {
			return true, nil
		}
	}
	return false, nil
}

func (f *fake) AcceptInvitationTx(_ context.Context, _ pgx.Tx, invID, userID, email string, _ time.Time) (Workspace, error) {
	inv, ok := f.invites[invID]
	if !ok || inv.Status != "pending" || inv.Email != email {
		return Workspace{}, webx.NewNotFound("invitation not found, expired, or already handled")
	}
	inv.Status = "accepted"
	f.invites[invID] = inv
	if _, ok := f.members[memberKeyOf(inv.WorkspaceID, userID)]; !ok {
		f.members[memberKeyOf(inv.WorkspaceID, userID)] = fakeMember{Member{UserID: userID, Role: inv.Role}}
	}
	return f.workspaces[inv.WorkspaceID], nil
}

func (f *fake) AcceptInvitation(ctx context.Context, invID, userID, email string, now time.Time) (Workspace, error) {
	return f.AcceptInvitationTx(ctx, nil, invID, userID, email, now)
}

func (f *fake) CreateShareLink(_ context.Context, wsID, codeHash, codePrefix, role, _ string, maxUses int, _ time.Time) (ShareLink, error) {
	l := ShareLink{ID: "link-1", CodePrefix: codePrefix, Role: role, MaxUses: maxUses}
	f.links[codeHash] = fakeLink{l}
	f.linkWS[codeHash] = wsID
	return l, nil
}

func (f *fake) RedeemShareLinkTx(_ context.Context, _ pgx.Tx, codeHash, userID string, _ time.Time) (Workspace, error) {
	fl, ok := f.links[codeHash]
	if !ok || fl.l.Uses >= fl.l.MaxUses {
		return Workspace{}, webx.NewNotFound("share link invalid or exhausted")
	}
	fl.l.Uses++
	f.links[codeHash] = fl
	ws, ok := f.workspaces[f.linkWS[codeHash]]
	if !ok {
		return Workspace{}, webx.NewNotFound("workspace gone")
	}
	if _, ok := f.members[memberKeyOf(ws.ID, userID)]; !ok {
		f.members[memberKeyOf(ws.ID, userID)] = fakeMember{Member{UserID: userID, Role: fl.l.Role}}
	}
	return ws, nil
}

func (f *fake) RedeemShareLink(ctx context.Context, codeHash, userID string, now time.Time) (Workspace, error) {
	return f.RedeemShareLinkTx(ctx, nil, codeHash, userID, now)
}

type fakeAuditor struct{ actions []string }

func (a *fakeAuditor) Record(_ context.Context, _ *string, _ *webx.Principal, action, _, _ string, _ map[string]any) {
	a.actions = append(a.actions, action)
}

var testNow = func() time.Time { return time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) }

func newSvc(repo Repo, auditor Auditor) *WorkspaceService {
	return NewWorkspaceService(repo, authz.New(nil, nil), nil, auditor, WorkspaceConfig{MaxPerUser: -1}, testNow)
}

func ownerP(userID string) *webx.Principal {
	return &webx.Principal{UserID: userID, Email: userID + "@test.local", Role: "owner"}
}

func memberP(userID string) *webx.Principal {
	return &webx.Principal{UserID: userID, Email: userID + "@test.local", Role: "member"}
}

func seedWS(t *testing.T) (*fake, Workspace) {
	t.Helper()
	f := newFake()
	ws, err := f.CreateWorkspaceWithOwner(context.Background(), "acme", "Acme", "alice", testNow())
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	return f, ws
}

func errStatus(t *testing.T, err error) int {
	t.Helper()
	var we *webx.Error
	if !errors.As(err, &we) {
		t.Fatalf("want webx.Error, got %T: %v", err, err)
	}
	return we.Status
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func TestCreate_AfterCreateHookRollsBackOnError(t *testing.T) {
	f, _ := seedWS(t)
	boom := errors.New("seed failed")
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		AfterCreate: func(_ context.Context, _ pgx.Tx, _, _ string) error { return boom },
	})

	_, err := svc.Create(context.Background(), ownerP("bob"), "bob-ws", "Bob")
	if !errors.Is(err, boom) {
		t.Fatalf("want hook error, got %v", err)
	}
	if _, ok, _ := f.GetWorkspace(context.Background(), "ws-bob-ws"); ok {
		t.Fatal("workspace must not exist after AfterCreate failure")
	}
	if _, ok, _ := f.GetMember(context.Background(), "ws-bob-ws", "bob"); ok {
		t.Fatal("owner membership must be rolled back")
	}
}

func TestCreate_AfterCreateHookCommitsOnSuccess(t *testing.T) {
	f, _ := seedWS(t)
	var gotWS, gotOwner string
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		AfterCreate: func(_ context.Context, _ pgx.Tx, wsID, ownerID string) error {
			gotWS, gotOwner = wsID, ownerID
			return nil
		},
	})

	ws, err := svc.Create(context.Background(), ownerP("bob"), "bob-ws", "Bob")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if gotWS != ws.ID || gotOwner != "bob" {
		t.Fatalf("hook args: ws=%s owner=%s", gotWS, gotOwner)
	}
	if _, ok, _ := f.GetWorkspace(context.Background(), ws.ID); !ok {
		t.Fatal("workspace must persist")
	}
}

func TestDeleteWorkspace_NonOwnerForbidden(t *testing.T) {
	f, ws := seedWS(t)
	f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{Member{UserID: "bob", Role: "member"}}
	svc := newSvc(f, nil)

	err := svc.DeleteWorkspace(context.Background(), memberP("bob"), ws.ID)
	if errStatus(t, err) != 403 {
		t.Fatalf("want 403, got %d", errStatus(t, err))
	}
	if f.called("delete-cascade:" + ws.ID) {
		t.Fatal("cascade must not run for non-owner")
	}
}

func TestDeleteWorkspace_NotMemberNotFound(t *testing.T) {
	f, ws := seedWS(t)
	svc := newSvc(f, nil)

	err := svc.DeleteWorkspace(context.Background(), ownerP("stranger"), ws.ID)
	if errStatus(t, err) != 404 {
		t.Fatalf("want 404, got %d", errStatus(t, err))
	}
}

func TestDeleteWorkspace_OwnerHappyPath(t *testing.T) {
	f, ws := seedWS(t)
	aud := &fakeAuditor{}
	var before, teardown string
	var teardownTx pgx.Tx
	svc := newSvc(f, aud).WithHooks(workspace.WorkspaceHooks{
		BeforeDelete: func(_ context.Context, wsID string) error {
			before = wsID
			return nil
		},
		OnTeardown: func(_ context.Context, tx pgx.Tx, wsID string) error {
			teardown, teardownTx = wsID, tx
			return nil
		},
	})

	if err := svc.DeleteWorkspace(context.Background(), ownerP("alice"), ws.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if before != ws.ID {
		t.Fatalf("BeforeDelete arg = %s", before)
	}
	if teardown != ws.ID || teardownTx == nil {
		t.Fatalf("OnTeardown arg = %s tx = %v", teardown, teardownTx)
	}
	if _, ok, _ := f.GetWorkspace(context.Background(), ws.ID); ok {
		t.Fatal("workspace must be deleted")
	}
	if !contains(aud.actions, "workspace.delete") {
		t.Fatalf("audit actions = %v", aud.actions)
	}
}

func TestDeleteWorkspace_BeforeDeleteBlocks(t *testing.T) {
	f, ws := seedWS(t)
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		BeforeDelete: func(_ context.Context, _ string) error { return errors.New("unpaid orders") },
	})

	err := svc.DeleteWorkspace(context.Background(), ownerP("alice"), ws.ID)
	if errStatus(t, err) != 409 {
		t.Fatalf("want 409, got %d", errStatus(t, err))
	}
	if _, ok, _ := f.GetWorkspace(context.Background(), ws.ID); !ok {
		t.Fatal("workspace must survive a blocked delete")
	}
}

func TestDeleteWorkspace_OnTeardownErrorDoesNotBlock(t *testing.T) {
	f, ws := seedWS(t)
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		OnTeardown: func(_ context.Context, _ pgx.Tx, _ string) error { return errors.New("cleanup failed") },
	})

	if err := svc.DeleteWorkspace(context.Background(), ownerP("alice"), ws.ID); err != nil {
		t.Fatalf("teardown hook error must not block delete: %v", err)
	}
	if _, ok, _ := f.GetWorkspace(context.Background(), ws.ID); ok {
		t.Fatal("workspace must be deleted despite teardown hook error")
	}
}

func TestRenameWorkspace(t *testing.T) {
	t.Run("owner 改名成功并留痕", func(t *testing.T) {
		f, ws := seedWS(t)
		aud := &fakeAuditor{}
		svc := newSvc(f, aud)

		got, err := svc.RenameWorkspace(context.Background(), ownerP("alice"), ws.ID, "新名字")
		if err != nil {
			t.Fatalf("rename: %v", err)
		}
		if got.Name != "新名字" {
			t.Fatalf("name = %s", got.Name)
		}
		if !contains(aud.actions, "workspace.rename") {
			t.Fatalf("audit actions = %v", aud.actions)
		}
	})
	t.Run("admin 可改名", func(t *testing.T) {
		f, ws := seedWS(t)
		f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{Member{UserID: "carol", Role: "admin"}}
		p := ownerP("carol")
		p.Role = "admin"
		svc := newSvc(f, nil)

		if _, err := svc.RenameWorkspace(context.Background(), p, ws.ID, "Admin 改的"); err != nil {
			t.Fatalf("rename: %v", err)
		}
	})
	t.Run("member 403", func(t *testing.T) {
		f, ws := seedWS(t)
		f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{Member{UserID: "bob", Role: "member"}}
		svc := newSvc(f, nil)

		_, err := svc.RenameWorkspace(context.Background(), memberP("bob"), ws.ID, "越权")
		if errStatus(t, err) != 403 {
			t.Fatalf("want 403, got %d", errStatus(t, err))
		}
	})
	t.Run("空名 400", func(t *testing.T) {
		f, ws := seedWS(t)
		svc := newSvc(f, nil)

		_, err := svc.RenameWorkspace(context.Background(), ownerP("alice"), ws.ID, "")
		if errStatus(t, err) != 400 {
			t.Fatalf("want 400, got %d", errStatus(t, err))
		}
	})
	t.Run("工作区不存在 404", func(t *testing.T) {
		f, _ := seedWS(t)
		svc := newSvc(f, nil)

		_, err := svc.RenameWorkspace(context.Background(), ownerP("alice"), "ws-nope", "x")
		if errStatus(t, err) != 404 {
			t.Fatalf("want 404, got %d", errStatus(t, err))
		}
	})
}

func TestRemoveMember_OnMemberRemovedFiresAfterSuccess(t *testing.T) {
	f, ws := seedWS(t)
	f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{Member{UserID: "bob", Role: "member"}}
	var removed []string
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		OnMemberRemoved: func(_ context.Context, wsID, userID string) error {
			removed = append(removed, wsID+"/"+userID)
			return nil
		},
	})

	if err := svc.RemoveMember(context.Background(), ownerP("alice"), ws.ID, "bob"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if len(removed) != 1 || removed[0] != ws.ID+"/bob" {
		t.Fatalf("OnMemberRemoved calls = %v", removed)
	}
}

func TestRemoveMember_BeforeMemberRemoveBlocks(t *testing.T) {
	f, ws := seedWS(t)
	f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{Member{UserID: "bob", Role: "member"}}
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		BeforeMemberRemove: func(_ context.Context, _, _ string) error { return errors.New("has open tasks") },
	})

	err := svc.RemoveMember(context.Background(), ownerP("alice"), ws.ID, "bob")
	if errStatus(t, err) != 409 {
		t.Fatalf("want 409, got %d", errStatus(t, err))
	}
	if f.called("soft-remove:bob") {
		t.Fatal("SoftRemoveMember must not run when BeforeMemberRemove fails")
	}
	if _, ok, _ := f.GetMember(context.Background(), ws.ID, "bob"); !ok {
		t.Fatal("member must survive a blocked removal")
	}
}

func TestLeave_TriggersOnMemberRemoved(t *testing.T) {
	f, ws := seedWS(t)
	f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{Member{UserID: "bob", Role: "member"}}
	var removed []string
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		OnMemberRemoved: func(_ context.Context, wsID, userID string) error {
			removed = append(removed, wsID+"/"+userID)
			return nil
		},
	})

	if err := svc.Leave(context.Background(), memberP("bob"), ws.ID); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if len(removed) != 1 || removed[0] != ws.ID+"/bob" {
		t.Fatalf("OnMemberRemoved calls = %v", removed)
	}
}

func TestAcceptInvitation_AfterMemberJoinRollsBackOnError(t *testing.T) {
	f, ws := seedWS(t)
	if _, err := f.CreateInvitation(context.Background(), ws.ID, "bob@test.local", "member", "alice", testNow()); err != nil {
		t.Fatal(err)
	}
	boom := errors.New("welcome mail broke")
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		AfterMemberJoin: func(_ context.Context, _ pgx.Tx, _, _, _ string) error { return boom },
	})

	p := &webx.Principal{UserID: "bob", Email: "bob@test.local"}
	_, err := svc.AcceptInvitation(context.Background(), p, "inv-bob@test.local")
	if !errors.Is(err, boom) {
		t.Fatalf("want hook error, got %v", err)
	}
	if _, ok, _ := f.GetMember(context.Background(), ws.ID, "bob"); ok {
		t.Fatal("membership must be rolled back")
	}
	pending, _ := f.HasPendingInvitation(context.Background(), ws.ID, "bob@test.local")
	if !pending {
		t.Fatal("invitation must stay pending after rollback")
	}
}

func TestAcceptInvitation_AfterMemberJoinFiresWithRole(t *testing.T) {
	f, ws := seedWS(t)
	if _, err := f.CreateInvitation(context.Background(), ws.ID, "bob@test.local", "member", "alice", testNow()); err != nil {
		t.Fatal(err)
	}
	var gotWS, gotUser, gotRole string
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		AfterMemberJoin: func(_ context.Context, _ pgx.Tx, wsID, userID, role string) error {
			gotWS, gotUser, gotRole = wsID, userID, role
			return nil
		},
	})

	p := &webx.Principal{UserID: "bob", Email: "bob@test.local"}
	if _, err := svc.AcceptInvitation(context.Background(), p, "inv-bob@test.local"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if gotWS != ws.ID || gotUser != "bob" || gotRole != "member" {
		t.Fatalf("hook args: ws=%s user=%s role=%s", gotWS, gotUser, gotRole)
	}
	if _, ok, _ := f.GetMember(context.Background(), ws.ID, "bob"); !ok {
		t.Fatal("membership must exist")
	}
}

func TestRedeemShareLink_AfterMemberJoin(t *testing.T) {
	f, ws := seedWS(t)
	code := "aaaaaaaaaaaaaaaaaaaaaaaa"
	hash := domain.HashShareCode(code)
	if _, err := f.CreateShareLink(context.Background(), ws.ID, hash, "pfx", "member", "alice", 5, testNow()); err != nil {
		t.Fatal(err)
	}
	var joined string
	svc := newSvc(f, nil).WithHooks(workspace.WorkspaceHooks{
		AfterMemberJoin: func(_ context.Context, _ pgx.Tx, _, userID, _ string) error {
			joined = userID
			return nil
		},
	})

	if _, err := svc.RedeemShareLink(context.Background(), &webx.Principal{UserID: "bob"}, code); err != nil {
		t.Fatalf("redeem: %v", err)
	}
	if joined != "bob" {
		t.Fatalf("AfterMemberJoin user = %q", joined)
	}
	if _, ok, _ := f.GetMember(context.Background(), ws.ID, "bob"); !ok {
		t.Fatal("membership must exist")
	}
}
