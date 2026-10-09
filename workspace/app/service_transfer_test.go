package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace"
	"github.com/haozing/ploykit/workspace/domain"
)

func (f *fake) GetMemberUserStatus(_ context.Context, wsID, userID string) (Member, string, bool, error) {
	fm, ok := f.members[memberKeyOf(wsID, userID)]
	if !ok {
		return Member{}, "", false, nil
	}
	status := f.userStatus[userID]
	if status == "" {
		status = "active"
	}
	return fm.m, status, true, nil
}

func (f *fake) OldestActiveOwner(_ context.Context, wsID string) (Member, bool, error) {
	var best *Member
	for k, fm := range f.members {
		if splitKey(k)[0] != wsID || fm.m.Role != domain.RoleOwner {
			continue
		}
		m := fm.m
		if best == nil || m.CreatedAt.Before(best.CreatedAt) {
			best = &m
		}
	}
	if best == nil {
		return Member{}, false, nil
	}
	return *best, true, nil
}

func (f *fake) TransferOwnershipTx(_ context.Context, _ pgx.Tx, wsID, from, to string) error {
	if to == "vanishing" {
		return ErrNotFound
	}
	tk := memberKeyOf(wsID, to)
	tm, ok := f.members[tk]
	if !ok || tm.m.Role == domain.RoleOwner || f.userStatus[to] == "disabled" {
		return ErrNotFound
	}
	tm.m.Role = domain.RoleOwner
	f.members[tk] = tm
	f.record("promote:" + to)
	if f.boomAfterPromote {
		return errors.New("boom after promote")
	}
	fk := memberKeyOf(wsID, from)
	fm, ok := f.members[fk]
	if !ok || fm.m.Role != domain.RoleOwner {
		return ErrNotFound
	}
	fm.m.Role = domain.RoleMember
	f.members[fk] = fm
	f.record("demote:" + from)
	return nil
}

type transferAuditor struct {
	fakeAuditor
	metas []map[string]any
}

func (a *transferAuditor) Record(_ context.Context, _ *string, _ *webx.Principal, action, _, _ string, meta map[string]any) {
	a.actions = append(a.actions, action)
	a.metas = append(a.metas, meta)
}

func seedTransfer(t *testing.T) (*fake, Workspace, *WorkspaceService, *transferAuditor) {
	t.Helper()
	f, ws := seedWS(t)
	aud := &transferAuditor{}
	svc := newSvc(f, aud)
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	set := func(uid, role string, at time.Time) {
		f.members[memberKeyOf(ws.ID, uid)] = fakeMember{m: Member{
			UserID: uid, Email: uid + "@test.local", Role: role, CreatedAt: at,
		}}
	}
	set("alice", domain.RoleOwner, t0)
	set("dave", domain.RoleOwner, t0.Add(time.Hour))
	set("bob", domain.RoleAdmin, t0.Add(2*time.Hour))
	set("carol", domain.RoleMember, t0.Add(3*time.Hour))
	return f, ws, svc, aud
}

func roleOf(t *testing.T, f *fake, wsID, uid string) string {
	t.Helper()
	m, ok, _ := f.GetMember(context.Background(), wsID, uid)
	if !ok {
		t.Fatalf("%s 不是活跃成员", uid)
	}
	return m.Role
}

func TestTransferOwnership_Guards(t *testing.T) {
	ctx := context.Background()

	rejects := []struct {
		name  string
		actor *webx.Principal
		to    string
		want  int
		seed  func(f *fake, ws Workspace)
	}{
		{"admin 发起 → 403（所有权不是成员管理权）", memberP("bob"), "carol", 403, nil},
		{"member 发起 → 403", memberP("carol"), "bob", 403, nil},
		{"非成员非管理员 → 403", memberP("stranger"), "carol", 403, nil},
		{"目标非成员 → 404", ownerP("alice"), "ghost", 404, nil},
		{"目标用户 disabled → 409", ownerP("alice"), "carol", 409,
			func(f *fake, _ Workspace) { f.userStatus["carol"] = "disabled" }},
		{"目标已是 owner（co-owner）→ 409", ownerP("alice"), "dave", 409, nil},
		{"owner 转给自己 → 409", ownerP("alice"), "alice", 409, nil},
		{"无活跃 owner 且管理员发起 → 409", adminP("root"), "carol", 409,
			func(f *fake, ws Workspace) {
				delete(f.members, memberKeyOf(ws.ID, "alice"))
				delete(f.members, memberKeyOf(ws.ID, "dave"))
			}},
		{"并发竞态（事务内守卫失守）→ 409", ownerP("alice"), "vanishing", 409,
			func(f *fake, ws Workspace) {
				f.members[memberKeyOf(ws.ID, "vanishing")] = fakeMember{m: Member{
					UserID: "vanishing", Email: "v@t.co", Role: domain.RoleMember,
					CreatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
				}}
			}},
	}
	for _, tc := range rejects {
		t.Run(tc.name, func(t *testing.T) {
			f, ws, svc, aud := seedTransfer(t)
			if tc.seed != nil {
				tc.seed(f, ws)
			}
			if err := svc.TransferOwnership(ctx, tc.actor, ws.ID, tc.to); errStatus(t, err) != tc.want {
				t.Errorf("want %d, got %v", tc.want, err)
			}
			if len(aud.actions) != 0 {
				t.Errorf("被拒的转让不得写审计: %v", aud.actions)
			}
		})
	}

	allows := []struct {
		name string
		run  func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService)
	}{
		{
			name: "owner 转让成功：目标升 owner、原 owner 降 member、co-owner 不动",
			run: func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) {
				if err := svc.TransferOwnership(ctx, ownerP("alice"), ws.ID, "carol"); err != nil {
					t.Fatalf("got %v", err)
				}
				if got := roleOf(t, f, ws.ID, "carol"); got != domain.RoleOwner {
					t.Errorf("carol 角色 = %s", got)
				}
				if got := roleOf(t, f, ws.ID, "alice"); got != domain.RoleMember {
					t.Errorf("alice 应降为 member, got %s", got)
				}
				if got := roleOf(t, f, ws.ID, "dave"); got != domain.RoleOwner {
					t.Errorf("co-owner dave 不应被动: %s", got)
				}
			},
		},
		{
			name: "平台管理员豁免：非成员管理员发起，原 owner 仲裁为最早的 alice",
			run: func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) {
				if err := svc.TransferOwnership(ctx, adminP("root"), ws.ID, "carol"); err != nil {
					t.Fatalf("got %v", err)
				}
				if got := roleOf(t, f, ws.ID, "carol"); got != domain.RoleOwner {
					t.Errorf("carol 角色 = %s", got)
				}
				if got := roleOf(t, f, ws.ID, "alice"); got != domain.RoleMember {
					t.Errorf("最早 owner alice 应被降级, got %s", got)
				}
				if got := roleOf(t, f, ws.ID, "dave"); got != domain.RoleOwner {
					t.Errorf("dave 应保持 owner: %s", got)
				}
			},
		},
		{
			name: "平台管理员恰好是本区非 owner 成员：仍仲裁最早 owner",
			run: func(t *testing.T, f *fake, ws Workspace, svc *WorkspaceService) {
				f.members[memberKeyOf(ws.ID, "root")] = fakeMember{m: Member{
					UserID: "root", Email: "root@t.co", Role: domain.RoleAdmin,
					CreatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
				}}
				if err := svc.TransferOwnership(ctx, adminP("root"), ws.ID, "root"); err != nil {
					t.Fatalf("got %v", err)
				}
				if got := roleOf(t, f, ws.ID, "root"); got != domain.RoleOwner {
					t.Errorf("root 角色 = %s", got)
				}
				if got := roleOf(t, f, ws.ID, "alice"); got != domain.RoleMember {
					t.Errorf("from 应是 alice 而非发起者本人: %s", got)
				}
			},
		},
	}
	for _, tc := range allows {
		t.Run(tc.name, func(t *testing.T) {
			f, ws, svc, aud := seedTransfer(t)
			tc.run(t, f, ws, svc)
			if !contains(aud.actions, "workspace.owner_transfer") {
				t.Errorf("审计缺失: %v", aud.actions)
			}
			if n, _ := f.CountActiveOwners(ctx, ws.ID); n < 1 {
				t.Errorf("转让后活跃 owner 数 = %d（不可造出零 owner 区）", n)
			}
		})
	}

	t.Run("审计 meta 记前后 owner 与角色", func(t *testing.T) {
		_, ws, svc, aud := seedTransfer(t)
		if err := svc.TransferOwnership(ctx, ownerP("alice"), ws.ID, "bob"); err != nil {
			t.Fatalf("got %v", err)
		}
		if len(aud.metas) != 1 {
			t.Fatalf("审计次数 = %d", len(aud.metas))
		}
		meta := aud.metas[0]
		if meta["from_owner"] != "alice" || meta["from_role"] != domain.RoleOwner {
			t.Errorf("from 快照: %+v", meta)
		}
		if meta["to_owner"] != "bob" || meta["to_role"] != domain.RoleAdmin {
			t.Errorf("to 快照: %+v", meta)
		}
	})
}

func TestTransferOwnership_Hooks(t *testing.T) {
	ctx := context.Background()

	t.Run("BeforeOwnerChange 拦截（Validating）→ 409 且两行角色未变", func(t *testing.T) {
		f, ws, svc, _ := seedTransfer(t)
		svc = svc.WithHooks(workspace.WorkspaceHooks{
			BeforeOwnerChange: func(context.Context, string, string, string) error {
				return errors.New("target has unpaid invoices")
			},
		})
		if err := svc.TransferOwnership(ctx, ownerP("alice"), ws.ID, "carol"); errStatus(t, err) != 409 {
			t.Fatalf("got %v", err)
		}
		if got := roleOf(t, f, ws.ID, "alice"); got != domain.RoleOwner {
			t.Errorf("alice 不应被降级: %s", got)
		}
		if got := roleOf(t, f, ws.ID, "carol"); got != domain.RoleMember {
			t.Errorf("carol 不应被升级: %s", got)
		}
	})

	t.Run("BeforeOwnerChange/OnOwnerTransfer 参数（wsID, from, to）", func(t *testing.T) {
		_, ws, svc, _ := seedTransfer(t)
		var before, after [3]string
		svc = svc.WithHooks(workspace.WorkspaceHooks{
			BeforeOwnerChange: func(_ context.Context, a, b, c string) error {
				before = [3]string{a, b, c}
				return nil
			},
			OnOwnerTransfer: func(_ context.Context, a, b, c string) error {
				after = [3]string{a, b, c}
				return nil
			},
		})
		if err := svc.TransferOwnership(ctx, ownerP("alice"), ws.ID, "carol"); err != nil {
			t.Fatalf("got %v", err)
		}
		want := [3]string{ws.ID, "alice", "carol"}
		if before != want || after != want {
			t.Errorf("hook args: before=%v after=%v", before, after)
		}
	})

	t.Run("OnOwnerTransfer 失败不影响已完成转让（Observational）", func(t *testing.T) {
		f, ws, svc, _ := seedTransfer(t)
		svc = svc.WithHooks(workspace.WorkspaceHooks{
			OnOwnerTransfer: func(context.Context, string, string, string) error {
				return errors.New("notify broker down")
			},
		})
		if err := svc.TransferOwnership(ctx, ownerP("alice"), ws.ID, "carol"); err != nil {
			t.Fatalf("转让已提交，钩子失败不应上抛: %v", err)
		}
		if got := roleOf(t, f, ws.ID, "carol"); got != domain.RoleOwner {
			t.Errorf("carol 角色 = %s", got)
		}
	})
}

func TestTransferOwnership_AtomicityAndInvariant(t *testing.T) {
	ctx := context.Background()

	t.Run("事务中途失败 → 整体回滚（不可造出零 owner/双 owner 脏态）", func(t *testing.T) {
		f, ws, svc, aud := seedTransfer(t)
		f.boomAfterPromote = true
		if err := svc.TransferOwnership(ctx, ownerP("alice"), ws.ID, "carol"); err == nil {
			t.Fatal("want error")
		}
		if got := roleOf(t, f, ws.ID, "carol"); got != domain.RoleMember {
			t.Errorf("升级行应随事务回滚: %s", got)
		}
		if got := roleOf(t, f, ws.ID, "alice"); got != domain.RoleOwner {
			t.Errorf("alice 应仍是 owner: %s", got)
		}
		if n, _ := f.CountActiveOwners(ctx, ws.ID); n != 2 {
			t.Errorf("owner 数应回到 2, got %d", n)
		}
		if len(aud.actions) != 0 {
			t.Errorf("失败的事务不得写审计: %v", aud.actions)
		}
	})

	t.Run("last-owner 语义边界：转让后原 owner 已不再是 owner", func(t *testing.T) {

		f, ws, svc, _ := seedTransfer(t)
		for _, uid := range []string{"dave", "bob", "carol"} {
			delete(f.members, memberKeyOf(ws.ID, uid))
		}
		f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{m: Member{
			UserID: "bob", Email: "bob@t.co", Role: domain.RoleMember,
			CreatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
		}}
		if err := svc.Leave(ctx, ownerP("alice"), ws.ID); errStatus(t, err) != 409 {
			t.Fatalf("转让前 last owner 不可退出: %v", err)
		}
		if err := svc.TransferOwnership(ctx, ownerP("alice"), ws.ID, "bob"); err != nil {
			t.Fatalf("转让: %v", err)
		}
		if n, _ := f.CountActiveOwners(ctx, ws.ID); n != 1 {
			t.Errorf("转让后应有且仅有一个 owner, got %d", n)
		}
		if err := svc.Leave(ctx, ownerP("alice"), ws.ID); err != nil {
			t.Fatalf("转让后原 owner 已是 member，可退出: %v", err)
		}
		if err := svc.Leave(ctx, ownerP("bob"), ws.ID); errStatus(t, err) != 409 {
			t.Errorf("新 owner 是 last owner，不可退出: %v", err)
		}
		if n, _ := f.CountActiveOwners(ctx, ws.ID); n != 1 {
			t.Errorf("退出后 owner 数 = %d（不可为零）", n)
		}
	})
}
