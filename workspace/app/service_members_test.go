package app

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace/domain"
)

func (f *fake) IsMemberByEmail(_ context.Context, wsID, email string) (bool, error) {
	for k, fm := range f.members {
		if splitKey(k)[0] == wsID && fm.m.Email == email {
			return true, nil
		}
	}
	return false, nil
}

func pageOf[T any](all []T, page, pageSize int) Page[T] {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 1
	}
	start := (page - 1) * pageSize
	if start >= len(all) {
		return Page[T]{Items: []T{}, Total: len(all)}
	}
	end := min(start+pageSize, len(all))
	return Page[T]{Items: all[start:end], Total: len(all)}
}

func (f *fake) ListMembers(_ context.Context, wsID string, page, pageSize int) (Page[Member], error) {
	var all []Member
	for k, fm := range f.members {
		if splitKey(k)[0] == wsID {
			all = append(all, fm.m)
		}
	}
	slices.SortFunc(all, func(a, b Member) int { return strings.Compare(a.UserID, b.UserID) })
	return pageOf(all, page, pageSize), nil
}

func (f *fake) UpdateMemberRole(_ context.Context, wsID, userID, newRole string, _ time.Time) error {
	k := memberKeyOf(wsID, userID)
	fm, ok := f.members[k]
	if !ok {
		return ErrNotFound
	}

	if fm.m.Role == "owner" && f.otherActiveOwners(wsID, userID) == 0 {
		return ErrLastOwner
	}
	fm.m.Role = newRole
	f.members[k] = fm
	f.record("role:" + userID + "=" + newRole)
	return nil
}

func (f *fake) ListInvitations(_ context.Context, wsID string, page, pageSize int) (Page[Invitation], error) {
	var all []Invitation
	for _, inv := range f.invites {
		if inv.WorkspaceID == wsID {
			all = append(all, inv)
		}
	}
	slices.SortFunc(all, func(a, b Invitation) int { return strings.Compare(a.ID, b.ID) })
	return pageOf(all, page, pageSize), nil
}

func (f *fake) RevokeInvitation(_ context.Context, wsID, invID string, _ time.Time) error {
	inv, ok := f.invites[invID]
	if !ok || inv.WorkspaceID != wsID {
		return ErrNotFound
	}
	inv.Status = "revoked"
	f.invites[invID] = inv
	return nil
}

func (f *fake) PendingInvitationsByEmail(_ context.Context, email string) ([]InvitationWithWorkspace, error) {
	var out []InvitationWithWorkspace
	for _, inv := range f.invites {
		if inv.Email == email && inv.Status == "pending" {
			ws := f.workspaces[inv.WorkspaceID]
			out = append(out, InvitationWithWorkspace{Invitation: inv, WorkspaceName: ws.Name, WorkspaceSlug: ws.Slug})
		}
	}
	return out, nil
}

func (f *fake) DeclineInvitation(_ context.Context, invID, email string, _ time.Time) error {
	inv, ok := f.invites[invID]

	if !ok || inv.Email != email || inv.Status != "pending" {
		return ErrNotFound
	}
	inv.Status = "declined"
	f.invites[invID] = inv
	return nil
}

func (f *fake) ListShareLinks(_ context.Context, wsID string, page, pageSize int) (Page[ShareLink], error) {
	var all []ShareLink
	for h, fl := range f.links {
		if f.linkWS[h] == wsID {
			all = append(all, fl.l)
		}
	}
	slices.SortFunc(all, func(a, b ShareLink) int { return strings.Compare(a.ID, b.ID) })
	return pageOf(all, page, pageSize), nil
}

func (f *fake) RevokeShareLink(_ context.Context, wsID, linkID string, _ time.Time) error {
	for h, fl := range f.links {
		if fl.l.ID == linkID && f.linkWS[h] == wsID {
			delete(f.links, h)
			delete(f.linkWS, h)
			return nil
		}
	}
	return ErrNotFound
}

func (f *fake) ListWorkspacesByUser(_ context.Context, userID string) ([]WorkspaceMembership, error) {
	var out []WorkspaceMembership
	for k, fm := range f.members {
		if splitKey(k)[1] == userID {
			ws := f.workspaces[splitKey(k)[0]]
			out = append(out, WorkspaceMembership{Workspace: ws, Role: fm.m.Role})
		}
	}
	return out, nil
}

type fakeWAMail struct{ to []string }

func (m *fakeWAMail) SendInvite(_ context.Context, to, _, _ string) error {
	m.to = append(m.to, to)
	return nil
}

func seedMembers(t *testing.T) (*fake, Workspace, *WorkspaceService, *fakeAuditor) {
	t.Helper()
	f, ws := seedWS(t)
	aud := &fakeAuditor{}
	svc := newSvc(f, aud)
	f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{m: Member{UserID: "bob", Email: "bob@test.local", Role: "admin"}}
	f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{m: Member{UserID: "carol", Email: "carol@test.local", Role: "member"}}
	f.members[memberKeyOf(ws.ID, "dave")] = fakeMember{m: Member{UserID: "dave", Email: "dave@test.local", Role: domain.RoleOwner}}
	return f, ws, svc, aud
}

func TestUpdateMemberRole_UTWA03(t *testing.T) {
	ctx := context.Background()

	t.Run("member 发起 → 403", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		err := svc.UpdateMemberRole(ctx, memberP("carol"), ws.ID, "bob", "member")
		if errStatus(t, err) != 403 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("owner 角色不可直接授予 → 400", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		err := svc.UpdateMemberRole(ctx, ownerP("alice"), ws.ID, "carol", domain.RoleOwner)
		if errStatus(t, err) != 400 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("目标成员不存在 → 404", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		err := svc.UpdateMemberRole(ctx, ownerP("alice"), ws.ID, "ghost", "member")
		if errStatus(t, err) != 404 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("改自己角色 → 403", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		err := svc.UpdateMemberRole(ctx, ownerP("alice"), ws.ID, "alice", "admin")
		if errStatus(t, err) != 403 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("非 owner 降级 owner → 403", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		err := svc.UpdateMemberRole(ctx, memberP("bob"), ws.ID, "dave", "member")
		if errStatus(t, err) != 403 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("最后 owner 降级 → 409", func(t *testing.T) {
		f, ws, svc, _ := seedMembers(t)
		delete(f.members, memberKeyOf(ws.ID, "alice"))

		err := svc.UpdateMemberRole(ctx, adminP("root"), ws.ID, "dave", "member")
		if errStatus(t, err) != 409 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("admin→member 成功 + 审计", func(t *testing.T) {
		f, ws, svc, aud := seedMembers(t)
		if err := svc.UpdateMemberRole(ctx, ownerP("alice"), ws.ID, "bob", "member"); err != nil {
			t.Fatalf("got %v", err)
		}
		if got, _, _ := f.GetMember(ctx, ws.ID, "bob"); got.Role != "member" {
			t.Errorf("角色未变更: %+v", got)
		}
		if !contains(aud.actions, "member.role_change") {
			t.Errorf("审计缺失: %v", aud.actions)
		}
	})
}

func TestRemoveMemberGuards_UTWA04(t *testing.T) {
	ctx := context.Background()
	f, ws, svc, _ := seedMembers(t)

	if err := svc.RemoveMember(ctx, memberP("carol"), ws.ID, "bob"); errStatus(t, err) != 403 {
		t.Errorf("member remove: got %v", err)
	}

	if err := svc.RemoveMember(ctx, ownerP("alice"), ws.ID, "alice"); errStatus(t, err) != 403 {
		t.Errorf("self remove: got %v", err)
	}

	f2, ws2, svc2, _ := seedMembers(t)
	delete(f2.members, memberKeyOf(ws2.ID, "alice"))
	if err := svc2.RemoveMember(ctx, memberP("bob"), ws2.ID, "dave"); errStatus(t, err) != 409 {
		t.Errorf("last owner remove: got %v", err)
	}
	_ = f
}

func TestLeave_UTWA05(t *testing.T) {
	ctx := context.Background()
	f, ws := seedWS(t)
	svc := newSvc(f, nil)

	if err := svc.Leave(ctx, memberP("ghost"), ws.ID); errStatus(t, err) != 404 {
		t.Errorf("non-member: got %v", err)
	}
	if err := svc.Leave(ctx, ownerP("alice"), ws.ID); errStatus(t, err) != 409 {
		t.Errorf("last owner: got %v", err)
	}
	f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{m: Member{UserID: "carol", Email: "carol@test.local", Role: "member"}}
	if err := svc.Leave(ctx, memberP("carol"), ws.ID); err != nil {
		t.Errorf("member leave: got %v", err)
	}
	if _, ok, _ := f.GetMember(ctx, ws.ID, "carol"); ok {
		t.Error("退出后成员行应被软删")
	}
}

func TestInvite_UTWA06(t *testing.T) {
	ctx := context.Background()
	f, ws := seedWS(t)
	mail := &fakeWAMail{}
	aud := &fakeAuditor{}
	svc := NewWorkspaceService(f, authz.New(nil, nil), mail, aud, WorkspaceConfig{MaxPerUser: -1}, testNow)

	if _, err := svc.Invite(ctx, memberP("carol"), ws.ID, "x@y.co", "member"); errStatus(t, err) != 403 {
		t.Errorf("member invite: got %v", err)
	}
	if _, err := svc.Invite(ctx, ownerP("alice"), ws.ID, "not-an-email", "member"); errStatus(t, err) != 400 {
		t.Errorf("bad email: got %v", err)
	}
	if _, err := svc.Invite(ctx, ownerP("alice"), ws.ID, "x@y.co", "owner"); errStatus(t, err) != 400 {
		t.Errorf("bad role: got %v", err)
	}
	f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{m: Member{UserID: "bob", Email: "bob@test.local", Role: "member"}}
	if _, err := svc.Invite(ctx, ownerP("alice"), ws.ID, "BOB@test.local", "member"); errStatus(t, err) != 409 {
		t.Errorf("already member（应含大小写归一）: got %v", err)
	}
	if _, err := svc.Invite(ctx, ownerP("alice"), ws.ID, "new@y.co", "member"); err != nil {
		t.Fatalf("first invite: %v", err)
	}
	if _, err := svc.Invite(ctx, ownerP("alice"), ws.ID, "new@y.co", "member"); errStatus(t, err) != 409 {
		t.Errorf("dup pending: got %v", err)
	}
	mail.to = nil
	inv, err := svc.Invite(ctx, ownerP("alice"), ws.ID, "  Other@Y.CO  ", "admin")
	if err != nil {
		t.Fatalf("ok path: %v", err)
	}
	if inv.Email != "other@y.co" || inv.Role != "admin" {
		t.Errorf("邀请应归一化: %+v", inv)
	}
	if len(mail.to) != 1 || mail.to[0] != "other@y.co" {
		t.Errorf("邮件应发送一次: %v", mail.to)
	}
	if !contains(aud.actions, "invitation.create") {
		t.Errorf("审计缺失: %v", aud.actions)
	}
}

func TestCreateShareLink_UTWA07(t *testing.T) {
	ctx := context.Background()
	f, ws := seedWS(t)
	aud := &fakeAuditor{}
	svc := newSvc(f, aud)

	if _, _, err := svc.CreateShareLink(ctx, memberP("carol"), ws.ID, "member", 10, domain.InviteTTL); errStatus(t, err) != 403 {
		t.Errorf("member: got %v", err)
	}
	if _, _, err := svc.CreateShareLink(ctx, ownerP("alice"), ws.ID, "owner", 10, domain.InviteTTL); errStatus(t, err) != 400 {
		t.Errorf("bad role: got %v", err)
	}
	for _, bad := range []int{0, 1001, -1} {
		if _, _, err := svc.CreateShareLink(ctx, ownerP("alice"), ws.ID, "member", bad, domain.InviteTTL); errStatus(t, err) != 400 {
			t.Errorf("max_uses=%d 应 400, got %v", bad, err)
		}
	}

	for _, badTTL := range []time.Duration{0, -time.Hour, 30*24*time.Hour + time.Second} {
		if _, _, err := svc.CreateShareLink(ctx, ownerP("alice"), ws.ID, "member", 10, badTTL); errStatus(t, err) != 400 {
			t.Errorf("ttl=%v 应 400, got %v", badTTL, err)
		}
	}
	link, code, err := svc.CreateShareLink(ctx, ownerP("alice"), ws.ID, "member", 100, domain.InviteTTL)
	if err != nil {
		t.Fatalf("ok path: %v", err)
	}

	if _, _, err := svc.CreateShareLink(ctx, ownerP("alice"), ws.ID, "member", 100, 30*24*time.Hour); err != nil {
		t.Errorf("ttl=30d 应合法: %v", err)
	}
	if len(code) != domain.ShareCodeLen || !domain.ShareCodeOK(code) {
		t.Errorf("明文码格式: %q", code)
	}
	if link.MaxUses != 100 || link.Role != "member" {
		t.Errorf("link 字段: %+v", link)
	}
	for h := range f.links {
		if h == code {
			t.Error("库中不应存明文码")
		}
	}
	if !contains(aud.actions, "share_link.create") {
		t.Errorf("审计缺失: %v", aud.actions)
	}
}

func TestRevokeInvitationAndLink_UTWA08(t *testing.T) {
	ctx := context.Background()
	f, ws := seedWS(t)
	aud := &fakeAuditor{}
	svc := newSvc(f, aud)

	if err := svc.RevokeInvitation(ctx, memberP("carol"), ws.ID, "inv-x"); errStatus(t, err) != 403 {
		t.Errorf("member revoke inv: got %v", err)
	}
	if err := svc.RevokeInvitation(ctx, ownerP("alice"), ws.ID, "inv-none"); errStatus(t, err) != 404 {
		t.Errorf("missing inv: got %v", err)
	}
	f.invites["inv-1"] = Invitation{ID: "inv-1", WorkspaceID: ws.ID, Email: "x@y.co", Status: "pending"}
	if err := svc.RevokeInvitation(ctx, ownerP("alice"), ws.ID, "inv-1"); err != nil {
		t.Errorf("revoke inv: %v", err)
	}
	if f.invites["inv-1"].Status != "revoked" {
		t.Errorf("状态应置 revoked: %+v", f.invites["inv-1"])
	}
	if err := svc.RevokeShareLink(ctx, ownerP("alice"), ws.ID, "link-none"); errStatus(t, err) != 404 {
		t.Errorf("missing link: got %v", err)
	}
	code, _ := domain.MintShareCode()
	f.links[domain.HashShareCode(code)] = fakeLink{l: ShareLink{ID: "link-9", Role: "member"}}
	f.linkWS[domain.HashShareCode(code)] = ws.ID
	if err := svc.RevokeShareLink(ctx, ownerP("alice"), ws.ID, "link-9"); err != nil {
		t.Errorf("revoke link: %v", err)
	}
	if !contains(aud.actions, "share_link.revoke") || !contains(aud.actions, "invitation.revoke") {
		t.Errorf("审计缺失: %v", aud.actions)
	}
}

func TestReadPathsAndDecline_UTWA09(t *testing.T) {
	ctx := context.Background()
	f, ws := seedWS(t)
	svc := newSvc(f, nil)
	f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{m: Member{UserID: "carol", Email: "carol@test.local", Role: "member"}}
	f.invites["inv-1"] = Invitation{ID: "inv-1", WorkspaceID: ws.ID, Email: "x@y.co", Status: "pending"}
	code, _ := domain.MintShareCode()
	f.links[domain.HashShareCode(code)] = fakeLink{l: ShareLink{ID: "link-1", Role: "member"}}
	f.linkWS[domain.HashShareCode(code)] = ws.ID

	if ms, err := svc.ListMembers(ctx, ws.ID, 1, 50); err != nil || len(ms.Items) != 2 || ms.Total != 2 {
		t.Errorf("ListMembers: %v, page=%+v", err, ms)
	}
	if invs, err := svc.ListInvitations(ctx, memberP("carol"), ws.ID, 1, 50); err != nil || len(invs.Items) != 1 || invs.Total != 1 {
		t.Errorf("ListInvitations(member): %v, page=%+v", err, invs)
	}
	if ls, err := svc.ListShareLinks(ctx, memberP("carol"), ws.ID, 1, 50); err != nil || len(ls.Items) != 1 || ls.Total != 1 {
		t.Errorf("ListShareLinks(member): %v, page=%+v", err, ls)
	}
	if mine, err := svc.ListMine(ctx, ownerP("alice")); err != nil || len(mine) != 1 {
		t.Errorf("ListMine: %v", err)
	}
	if pend, err := svc.MyInvitations(ctx, &webx.Principal{UserID: "x", Email: "x@y.co"}); err != nil {
		t.Errorf("MyInvitations: %v", err)
	} else if len(pend) != 1 {
		t.Errorf("MyInvitations n=%d want 1（x@y.co pending）", len(pend))
	}

	if err := svc.DeclineInvitation(ctx, &webx.Principal{UserID: "o", Email: "other@y.co"}, "inv-1"); errStatus(t, err) != 404 {
		t.Errorf("email mismatch 应 404, got %v", err)
	}
	aud := &fakeAuditor{}
	svc2 := newSvc(f, aud)
	if err := svc2.DeclineInvitation(ctx, &webx.Principal{UserID: "x", Email: "x@y.co"}, "inv-1"); err != nil {
		t.Errorf("decline: %v", err)
	}
	if f.invites["inv-1"].Status != "declined" || !contains(aud.actions, "invitation.decline") {
		t.Errorf("decline 落库/审计: %+v %v", f.invites["inv-1"], aud.actions)
	}

	if err := svc2.DeclineInvitation(ctx, &webx.Principal{UserID: "x", Email: "x@y.co"}, "inv-1"); errStatus(t, err) != 404 {
		t.Errorf("重复 decline 终态应 404, got %v", err)
	}
}

func TestRemovedByRecorded_WA11(t *testing.T) {
	ctx := context.Background()

	t.Run("RemoveMember 记录移除者", func(t *testing.T) {
		f, ws, svc, _ := seedMembers(t)
		if err := svc.RemoveMember(ctx, ownerP("alice"), ws.ID, "carol"); err != nil {
			t.Fatalf("remove: %v", err)
		}
		if !f.called("soft-remove:carol:by=alice") {
			t.Errorf("removed_by 应为移除者 alice, calls=%v", f.calls)
		}
	})

	t.Run("Leave 记录本人", func(t *testing.T) {
		f, ws := seedWS(t)
		f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{m: Member{UserID: "carol", Email: "carol@test.local", Role: "member"}}
		svc := newSvc(f, nil)
		if err := svc.Leave(ctx, memberP("carol"), ws.ID); err != nil {
			t.Fatalf("leave: %v", err)
		}
		if !f.called("soft-remove:carol:by=carol") {
			t.Errorf("自离 removed_by 应为本人 carol, calls=%v", f.calls)
		}
	})
}

func adminP(userID string) *webx.Principal {
	return &webx.Principal{UserID: userID, Email: userID + "@test.local", IsPlatformAdmin: true}
}

func TestPlatformAdminExemption_A1(t *testing.T) {
	ctx := context.Background()

	okCases := []struct {
		name   string
		run    func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) error
		verify func(t *testing.T, f *fake, ws Workspace)
	}{
		{
			name: "改成员角色",
			run: func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) error {
				return svc.UpdateMemberRole(ctx, adminP("root"), ws.ID, "bob", "member")
			},
			verify: func(t *testing.T, f *fake, ws Workspace) {
				if got, _, _ := f.GetMember(ctx, ws.ID, "bob"); got.Role != "member" {
					t.Errorf("bob 角色应已变更: %+v", got)
				}
			},
		},
		{
			name: "移除成员",
			run: func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) error {
				return svc.RemoveMember(ctx, adminP("root"), ws.ID, "carol")
			},
			verify: func(t *testing.T, f *fake, ws Workspace) {
				if _, ok, _ := f.GetMember(ctx, ws.ID, "carol"); ok {
					t.Error("carol 应已被移除")
				}
			},
		},
		{
			name: "删除工作区",
			run: func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) error {
				return svc.DeleteWorkspace(ctx, adminP("root"), ws.ID)
			},
			verify: func(t *testing.T, f *fake, ws Workspace) {
				if _, ok, _ := f.GetWorkspace(ctx, ws.ID); ok {
					t.Error("工作区应已被删除")
				}
				if !f.called("delete-cascade:" + ws.ID) {
					t.Error("级联删除应被执行")
				}
			},
		},
		{
			name: "降级非 last owner（豁免 owner-only 发起校验）",
			run: func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) error {
				return svc.UpdateMemberRole(ctx, adminP("root"), ws.ID, "dave", "admin")
			},
			verify: func(t *testing.T, f *fake, ws Workspace) {
				if got, _, _ := f.GetMember(ctx, ws.ID, "dave"); got.Role != "admin" {
					t.Errorf("dave 应被降级: %+v", got)
				}
			},
		},
	}
	for _, tc := range okCases {
		t.Run("平台管理员非成员·"+tc.name, func(t *testing.T) {
			f, ws, svc, aud := seedMembers(t)
			if err := tc.run(t, f, ws, svc); err != nil {
				t.Fatalf("平台管理员应放行: %v", err)
			}
			tc.verify(t, f, ws)
			if len(aud.actions) == 0 {
				t.Error("操作应留审计")
			}
		})
	}

	t.Run("last-owner 降级仍 409", func(t *testing.T) {
		f, ws, svc, _ := seedMembers(t)
		delete(f.members, memberKeyOf(ws.ID, "alice"))
		if err := svc.UpdateMemberRole(ctx, adminP("root"), ws.ID, "dave", "member"); errStatus(t, err) != 409 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("last-owner 移除仍 409", func(t *testing.T) {
		f, ws, svc, _ := seedMembers(t)
		delete(f.members, memberKeyOf(ws.ID, "alice"))
		if err := svc.RemoveMember(ctx, adminP("root"), ws.ID, "dave"); errStatus(t, err) != 409 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("角色枚举仍 400（不可直接授予 owner）", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		if err := svc.UpdateMemberRole(ctx, adminP("root"), ws.ID, "carol", domain.RoleOwner); errStatus(t, err) != 400 {
			t.Errorf("got %v", err)
		}
	})

	t.Run("非管理员非成员改角色仍 403", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		if err := svc.UpdateMemberRole(ctx, memberP("stranger"), ws.ID, "bob", "member"); errStatus(t, err) != 403 {
			t.Errorf("got %v", err)
		}
	})
	t.Run("非管理员非成员删区仍 404", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		if err := svc.DeleteWorkspace(ctx, memberP("stranger"), ws.ID); errStatus(t, err) != 404 {
			t.Errorf("got %v", err)
		}
	})
}

type guardFake struct {
	*fake
	demoted       string
	softRemovedBy map[string]string
}

func (g *guardFake) UpdateMemberRole(_ context.Context, _, userID, _ string, _ time.Time) error {
	g.demoted = userID
	return ErrLastOwner
}

func (g *guardFake) SoftRemoveMember(_ context.Context, _, userID, removedBy string, _ time.Time) error {
	g.softRemovedBy[userID] = removedBy
	return ErrLastOwner
}

func newGuardSvc(t *testing.T) (*guardFake, Workspace, *WorkspaceService) {
	t.Helper()
	f, ws := seedWS(t)
	g := &guardFake{fake: f, softRemovedBy: map[string]string{}}

	f.members[memberKeyOf(ws.ID, "dave")] = fakeMember{m: Member{UserID: "dave", Email: "dave@test.local", Role: domain.RoleOwner}}
	return g, ws, newSvc(g, nil)
}

func TestLastOwnerGuardMapsToConflict_P2_8(t *testing.T) {
	ctx := context.Background()

	t.Run("UpdateMemberRole 守卫拒绝 → 409", func(t *testing.T) {
		g, ws, svc := newGuardSvc(t)
		err := svc.UpdateMemberRole(ctx, ownerP("alice"), ws.ID, "dave", "member")
		if errStatus(t, err) != 409 {
			t.Errorf("got %v", err)
		}
		if g.demoted != "dave" {
			t.Errorf("仓储应被调用: %q", g.demoted)
		}
	})
	t.Run("RemoveMember 守卫拒绝 → 409", func(t *testing.T) {
		g, ws, svc := newGuardSvc(t)
		err := svc.RemoveMember(ctx, ownerP("alice"), ws.ID, "dave")
		if errStatus(t, err) != 409 {
			t.Errorf("got %v", err)
		}
		if g.softRemovedBy["dave"] != "alice" {
			t.Errorf("仓储应被调用: %v", g.softRemovedBy)
		}
	})
	t.Run("Leave 守卫拒绝 → 409", func(t *testing.T) {
		g, ws, svc := newGuardSvc(t)

		err := svc.Leave(ctx, ownerP("alice"), ws.ID)
		if errStatus(t, err) != 409 {
			t.Errorf("got %v", err)
		}
		if g.softRemovedBy["alice"] != "alice" {
			t.Errorf("仓储应被调用: %v", g.softRemovedBy)
		}
	})
}
