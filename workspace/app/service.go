package app

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace"
	"github.com/haozing/ploykit/workspace/domain"
)

type WorkspaceService struct {
	repo    Repo
	authz   *authz.Authorizer
	mail    EmailSender
	auditor Auditor
	cfg     WorkspaceConfig
	now     Clock
	hooks   workspace.WorkspaceHooks
}

func NewWorkspaceService(repo Repo, az *authz.Authorizer, mail EmailSender, auditor Auditor, cfg WorkspaceConfig, now Clock) *WorkspaceService {
	if az == nil {
		panic("workspace/app: NewWorkspaceService requires a non-nil *authz.Authorizer (WA4)")
	}
	return &WorkspaceService{repo: repo, authz: az, mail: mail, auditor: auditor, cfg: cfg, now: now}
}

func (s *WorkspaceService) principalIn(ctx context.Context, actor *webx.Principal, wsID string) (*webx.Principal, bool) {
	if actor.WorkspaceID == wsID && actor.WorkspaceID != "" {
		return actor, true
	}
	if actor.IsPlatformAdmin {
		cp := *actor
		cp.WorkspaceID = wsID
		return &cp, true
	}
	me, ok, err := s.repo.GetMember(ctx, wsID, actor.UserID)
	if err != nil || !ok {
		return nil, false
	}
	cp := *actor
	cp.WorkspaceID, cp.Role = wsID, me.Role
	return &cp, true
}

func (s *WorkspaceService) canIn(ctx context.Context, actor *webx.Principal, wsID string, perm authz.Permission) bool {
	p, ok := s.principalIn(ctx, actor, wsID)
	return ok && s.authz.CanIn(ctx, p, perm)
}

func (s *WorkspaceService) WithHooks(h workspace.WorkspaceHooks) *WorkspaceService {
	s.hooks = h
	return s
}

func (s *WorkspaceService) audit(ctx context.Context, wsID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any) {
	if s.auditor != nil {
		s.auditor.Record(ctx, wsID, p, action, resourceType, resourceID, meta)
	}
}

func memberRoleInTx(ctx context.Context, tx pgx.Tx, workspaceID, userID string) (string, error) {
	var role string
	err := tx.QueryRow(ctx,
		`SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NULL`,
		workspaceID, userID).Scan(&role)
	return role, err
}

func normalizeSlug(slug string) string {
	return strings.ToLower(strings.TrimSpace(slug))
}

func (s *WorkspaceService) Create(ctx context.Context, p *webx.Principal, slug, name string) (Workspace, error) {
	slug = normalizeSlug(slug)
	if !domain.SlugOK(slug) {
		return Workspace{}, webx.NewValidation("slug must be 4-40 chars of [a-z0-9-], not starting/ending with '-'")
	}
	if domain.SlugReserved(slug) {
		return Workspace{}, webx.NewValidation("slug is reserved")
	}
	if name == "" {
		return Workspace{}, webx.NewValidation("name required")
	}

	var ws Workspace
	var err error
	err = s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if s.cfg.MaxPerUser >= 0 {
			n, err := s.repo.CountWorkspacesByUserForCreateTx(ctx, tx, p.UserID)
			if err != nil {
				return err
			}
			if n >= s.cfg.MaxPerUser {
				return webx.NewQuotaExceeded("workspace limit reached")
			}
		}
		var e error
		ws, e = s.repo.CreateWorkspaceWithOwnerTx(ctx, tx, slug, name, p.UserID, s.now())
		if e != nil {
			return e
		}
		if s.hooks.AfterCreate != nil {
			return s.hooks.AfterCreate(ctx, tx, ws.ID, p.UserID)
		}
		return nil
	})
	if err != nil {
		if err == ErrDuplicate {
			return Workspace{}, webx.NewConflict("slug already taken")
		}
		return Workspace{}, err
	}

	s.audit(ctx, &ws.ID, p, "workspace.create", "workspace", ws.ID, map[string]any{"slug": slug})
	return ws, nil
}

func (s *WorkspaceService) ListMine(ctx context.Context, p *webx.Principal) ([]WorkspaceMembership, error) {
	return s.repo.ListWorkspacesByUser(ctx, p.UserID)
}

func (s *WorkspaceService) DeleteWorkspace(ctx context.Context, p *webx.Principal, workspaceID string) error {

	if !p.IsPlatformAdmin {
		me, ok, err := s.repo.GetMember(ctx, workspaceID, p.UserID)
		if err != nil {
			return err
		}
		if !ok {
			return webx.NewNotFound("workspace not found")
		}
		if me.Role != domain.RoleOwner {
			return webx.NewForbidden("owner required to delete a workspace")
		}
	}
	ws, ok, err := s.repo.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("workspace not found")
	}

	if s.hooks.BeforeDelete != nil {
		if err := s.hooks.BeforeDelete(ctx, workspaceID); err != nil {
			return webx.NewConflict("workspace cannot be deleted: " + err.Error())
		}
	}
	if err := s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {

		if s.hooks.OnTeardown != nil {
			if err := s.hooks.OnTeardown(ctx, tx, workspaceID); err != nil {
				slog.Warn("workspace teardown hook failed; continuing cascade delete",
					"workspace", workspaceID, "err", err)
			}
		}
		return s.repo.DeleteWorkspaceCascade(ctx, tx, workspaceID)
	}); err != nil {
		if err == ErrNotFound {
			return webx.NewNotFound("workspace not found")
		}
		return err
	}
	s.audit(ctx, nil, p, "workspace.delete", "workspace", workspaceID, map[string]any{"slug": ws.Slug, "name": ws.Name})
	return nil
}

func (s *WorkspaceService) RenameWorkspace(ctx context.Context, p *webx.Principal, workspaceID, name string) (Workspace, error) {

	if _, ok, err := s.repo.GetMember(ctx, workspaceID, p.UserID); err != nil {
		return Workspace{}, err
	} else if !ok {
		return Workspace{}, webx.NewNotFound("workspace not found")
	}

	if !s.canIn(ctx, p, workspaceID, authz.Permission("workspace:update")) {
		return Workspace{}, webx.NewForbidden("workspace:update required")
	}
	if name == "" {
		return Workspace{}, webx.NewValidation("name required")
	}
	if err := s.repo.UpdateWorkspaceName(ctx, workspaceID, name, s.now()); err != nil {
		if err == ErrNotFound {
			return Workspace{}, webx.NewNotFound("workspace not found")
		}
		return Workspace{}, err
	}
	ws, ok, err := s.repo.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return Workspace{}, err
	}
	if !ok {
		return Workspace{}, webx.NewNotFound("workspace not found")
	}
	s.audit(ctx, &workspaceID, p, "workspace.rename", "workspace", workspaceID, map[string]any{"name": name})
	return ws, nil
}

const (
	DefaultPageSize = 50
	MaxPageSize     = 200
)

func normalizePage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	return page, pageSize
}

func (s *WorkspaceService) ListMembers(ctx context.Context, wsID string, page, pageSize int) (Page[Member], error) {
	page, pageSize = normalizePage(page, pageSize)
	return s.repo.ListMembers(ctx, wsID, page, pageSize)
}

func (s *WorkspaceService) UpdateMemberRole(ctx context.Context, actor *webx.Principal, wsID, targetUserID, newRole string) error {

	who, ok := s.principalIn(ctx, actor, wsID)
	if !ok || !s.authz.CanIn(ctx, who, authz.Permission("members:write")) {
		return webx.NewForbidden("members:write required")
	}
	if !domain.AssignableRole(newRole) {
		return webx.NewValidation("role not assignable")
	}
	target, ok, err := s.repo.GetMember(ctx, wsID, targetUserID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("member not found")
	}
	if target.UserID == actor.UserID {
		return webx.NewForbidden("cannot change own role")
	}
	if target.Role == domain.RoleOwner {

		if !actor.IsPlatformAdmin && who.Role != domain.RoleOwner {
			return webx.NewForbidden("owner required to demote an owner")
		}
		if n, err := s.repo.CountActiveOwners(ctx, wsID); err != nil {
			return err
		} else if domain.LastOwnerProtected(target.Role, n <= 1, domain.ActionDemote) {
			return webx.NewConflict("cannot demote the last owner")
		}
	}
	if err := s.repo.UpdateMemberRole(ctx, wsID, targetUserID, newRole, s.now()); err != nil {

		if err == ErrLastOwner {
			return webx.NewConflict("cannot demote the last owner")
		}
		return err
	}
	s.audit(ctx, &wsID, actor, "member.role_change", "member", targetUserID, map[string]any{"from": target.Role, "to": newRole})
	return nil
}

func (s *WorkspaceService) RemoveMember(ctx context.Context, actor *webx.Principal, wsID, targetUserID string) error {

	if !s.canIn(ctx, actor, wsID, authz.Permission("members:remove")) {
		return webx.NewForbidden("members:remove required")
	}
	target, ok, err := s.repo.GetMember(ctx, wsID, targetUserID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("member not found")
	}
	if target.UserID == actor.UserID {
		return webx.NewForbidden("use leave instead")
	}
	if target.Role == domain.RoleOwner {
		if n, err := s.repo.CountActiveOwners(ctx, wsID); err != nil {
			return err
		} else if domain.LastOwnerProtected(target.Role, n <= 1, domain.ActionRemove) {
			return webx.NewConflict("cannot remove the last owner")
		}
	}

	if s.hooks.BeforeMemberRemove != nil {
		if err := s.hooks.BeforeMemberRemove(ctx, wsID, targetUserID); err != nil {
			return webx.NewConflict("member cannot be removed: " + err.Error())
		}
	}
	if err := s.repo.SoftRemoveMember(ctx, wsID, targetUserID, actor.UserID, s.now()); err != nil {

		if err == ErrLastOwner {
			return webx.NewConflict("cannot remove the last owner")
		}
		return err
	}
	s.audit(ctx, &wsID, actor, "member.remove", "member", targetUserID, nil)

	if s.hooks.OnMemberRemoved != nil {
		if err := s.hooks.OnMemberRemoved(ctx, wsID, targetUserID); err != nil {
			slog.Warn("member removed hook failed", "workspace", wsID, "user", targetUserID, "err", err)
		}
	}
	return nil
}

func (s *WorkspaceService) Leave(ctx context.Context, p *webx.Principal, wsID string) error {
	me, ok, err := s.repo.GetMember(ctx, wsID, p.UserID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("not a member")
	}
	if n, err := s.repo.CountActiveOwners(ctx, wsID); err != nil {
		return err
	} else if !domain.CanLeave(me.Role, n <= 1) {
		return webx.NewConflict("last owner cannot leave; transfer or delete the workspace")
	}
	if err := s.repo.SoftRemoveMember(ctx, wsID, p.UserID, p.UserID, s.now()); err != nil {

		if err == ErrLastOwner {
			return webx.NewConflict("last owner cannot leave; transfer or delete the workspace")
		}
		return err
	}
	s.audit(ctx, &wsID, p, "member.leave", "member", p.UserID, nil)

	if s.hooks.OnMemberRemoved != nil {
		if err := s.hooks.OnMemberRemoved(ctx, wsID, p.UserID); err != nil {
			slog.Warn("member removed hook failed", "workspace", wsID, "user", p.UserID, "err", err)
		}
	}
	return nil
}

func (s *WorkspaceService) Invite(ctx context.Context, actor *webx.Principal, wsID, rawEmail, role string) (Invitation, error) {

	if !s.canIn(ctx, actor, wsID, authz.Permission("members:invite")) {
		return Invitation{}, webx.NewForbidden("members:invite required")
	}
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return Invitation{}, webx.NewValidation("invalid email")
	}
	if !domain.AssignableRole(role) {
		return Invitation{}, webx.NewValidation("role not assignable")
	}
	if pending, err := s.repo.HasPendingInvitation(ctx, wsID, email); err != nil {
		return Invitation{}, err
	} else if pending {
		return Invitation{}, webx.NewConflict("invitation already pending")
	}
	if isMember, err := s.repo.IsMemberByEmail(ctx, wsID, email); err != nil {
		return Invitation{}, err
	} else if isMember {
		return Invitation{}, webx.NewConflict("already a member")
	}
	inv, err := s.repo.CreateInvitation(ctx, wsID, email, role, actor.UserID, domain.InviteExpiry(s.now()))
	if err != nil {
		if err == ErrDuplicate {
			return Invitation{}, webx.NewConflict("invitation already pending")
		}
		return Invitation{}, err
	}

	ws, ok, err := s.repo.GetWorkspace(ctx, wsID)
	if err != nil {
		slog.Warn("workspace lookup failed after invitation created", "workspace", wsID, "err", err)
	}
	if !ok {

		slog.Warn("workspace vanished after invitation created", "workspace", wsID)
	}
	if s.mail != nil {
		if err := s.mail.SendInvite(ctx, email, ws.Name, inv.ID); err != nil {
			slog.Warn("invite mail send failed", "workspace", wsID, "email", email, "err", err)
		}
	}
	s.audit(ctx, &wsID, actor, "invitation.create", "invitation", inv.ID, map[string]any{"email": email, "role": role})
	return inv, nil
}

func (s *WorkspaceService) ListInvitations(ctx context.Context, _ *webx.Principal, wsID string, page, pageSize int) (Page[Invitation], error) {
	page, pageSize = normalizePage(page, pageSize)
	return s.repo.ListInvitations(ctx, wsID, page, pageSize)
}

func (s *WorkspaceService) RevokeInvitation(ctx context.Context, actor *webx.Principal, wsID, invID string) error {

	if !s.canIn(ctx, actor, wsID, authz.Permission("members:invite")) {
		return webx.NewForbidden("members:invite required")
	}
	if err := s.repo.RevokeInvitation(ctx, wsID, invID, s.now()); err != nil {
		if err == ErrNotFound {
			return webx.NewNotFound("invitation not found")
		}
		return err
	}
	s.audit(ctx, &wsID, actor, "invitation.revoke", "invitation", invID, nil)
	return nil
}

func (s *WorkspaceService) MyInvitations(ctx context.Context, p *webx.Principal) ([]InvitationWithWorkspace, error) {
	return s.repo.PendingInvitationsByEmail(ctx, p.Email)
}

func (s *WorkspaceService) AcceptInvitation(ctx context.Context, p *webx.Principal, invID string) (Workspace, error) {
	var ws Workspace
	var err error
	if s.hooks.AfterMemberJoin != nil {
		err = s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			var err error
			ws, err = s.repo.AcceptInvitationTx(ctx, tx, invID, p.UserID, p.Email, s.now())
			if err != nil {
				return err
			}
			role, err := memberRoleInTx(ctx, tx, ws.ID, p.UserID)
			if err != nil {
				return err
			}
			return s.hooks.AfterMemberJoin(ctx, tx, ws.ID, p.UserID, role)
		})
	} else {
		ws, err = s.repo.AcceptInvitation(ctx, invID, p.UserID, p.Email, s.now())
	}
	if err != nil {
		return ws, err
	}
	s.audit(ctx, &ws.ID, p, "invitation.accept", "invitation", invID, nil)
	return ws, nil
}

func (s *WorkspaceService) DeclineInvitation(ctx context.Context, p *webx.Principal, invID string) error {
	if err := s.repo.DeclineInvitation(ctx, invID, p.Email, s.now()); err != nil {

		if err == ErrNotFound {
			return webx.NewNotFound("invitation not found")
		}
		return err
	}
	s.audit(ctx, nil, p, "invitation.decline", "invitation", invID, nil)
	return nil
}

func (s *WorkspaceService) CreateShareLink(ctx context.Context, actor *webx.Principal, wsID, role string, maxUses int, ttl time.Duration) (ShareLink, string, error) {

	if !s.canIn(ctx, actor, wsID, authz.Permission("members:invite")) {
		return ShareLink{}, "", webx.NewForbidden("members:invite required")
	}
	if !domain.AssignableRole(role) {
		return ShareLink{}, "", webx.NewValidation("role not assignable")
	}
	if maxUses < 1 || maxUses > 1000 {
		return ShareLink{}, "", webx.NewValidation("max_uses must be 1-1000")
	}

	if ttl <= 0 || ttl > 30*24*time.Hour {
		return ShareLink{}, "", webx.NewValidation("ttl must be (0, 30d]")
	}
	code, err := domain.MintShareCode()
	if err != nil {
		return ShareLink{}, "", err
	}
	link, err := s.repo.CreateShareLink(ctx, wsID, domain.HashShareCode(code), code[:8], role, actor.UserID, maxUses, s.now().Add(ttl))
	if err != nil {
		return ShareLink{}, "", err
	}
	s.audit(ctx, &wsID, actor, "share_link.create", "share_link", link.ID, map[string]any{"role": role, "max_uses": maxUses})
	return link, code, nil
}

func (s *WorkspaceService) ListShareLinks(ctx context.Context, _ *webx.Principal, wsID string, page, pageSize int) (Page[ShareLink], error) {
	page, pageSize = normalizePage(page, pageSize)
	return s.repo.ListShareLinks(ctx, wsID, page, pageSize)
}

func (s *WorkspaceService) RevokeShareLink(ctx context.Context, actor *webx.Principal, wsID, linkID string) error {

	if !s.canIn(ctx, actor, wsID, authz.Permission("members:invite")) {
		return webx.NewForbidden("members:invite required")
	}
	if err := s.repo.RevokeShareLink(ctx, wsID, linkID, s.now()); err != nil {
		if err == ErrNotFound {
			return webx.NewNotFound("share link not found")
		}
		return err
	}
	s.audit(ctx, &wsID, actor, "share_link.revoke", "share_link", linkID, nil)
	return nil
}

func (s *WorkspaceService) RedeemShareLink(ctx context.Context, p *webx.Principal, code string) (Workspace, error) {
	if !domain.ShareCodeOK(code) {
		return Workspace{}, webx.NewValidation("invalid share code")
	}
	codeHash := domain.HashShareCode(code)
	var ws Workspace
	var err error
	if s.hooks.AfterMemberJoin != nil {
		err = s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			var err error
			ws, err = s.repo.RedeemShareLinkTx(ctx, tx, codeHash, p.UserID, s.now())
			if err != nil {
				return err
			}
			role, err := memberRoleInTx(ctx, tx, ws.ID, p.UserID)
			if err != nil {
				return err
			}
			return s.hooks.AfterMemberJoin(ctx, tx, ws.ID, p.UserID, role)
		})
	} else {
		ws, err = s.repo.RedeemShareLink(ctx, codeHash, p.UserID, s.now())
	}
	if err != nil {
		return ws, err
	}
	s.audit(ctx, &ws.ID, p, "share_link.redeem", "workspace", ws.ID, nil)
	return ws, nil
}
