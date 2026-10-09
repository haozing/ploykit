package app

import (
	"context"
	"strings"

	"github.com/haozing/ploykit/platform/webx"
)

func errUserOpsNotWired() error {
	return webx.NewError(503, webx.CodeUnavailable, "user ops not wired")
}

type UserOpsService struct {
	admin    *AdminService
	userOps  UserDetailProvider
	wsLister WorkspaceLister
}

func NewUserOpsService(base *AdminService) *UserOpsService {
	return &UserOpsService{admin: base}
}

func (s *UserOpsService) WithUserOps(u UserDetailProvider) *UserOpsService {
	s.userOps = u
	return s
}

func (s *UserOpsService) WithWorkspaceLister(w WorkspaceLister) *UserOpsService {
	s.wsLister = w
	return s
}

func (s *UserOpsService) audit(ctx context.Context, p *webx.Principal, action, resourceID string, meta map[string]any) {
	if s.admin == nil || s.admin.auditor == nil {
		return
	}
	s.admin.auditor.Record(ctx, nil, p, action, "user", resourceID, meta)
}

func (s *UserOpsService) targetUser(ctx context.Context, userID string) (AdminUser, error) {
	u, ok, err := s.admin.repo.GetUserByID(ctx, userID)
	if err != nil {
		return AdminUser{}, err
	}
	if !ok {
		return AdminUser{}, webx.NewNotFound("user not found")
	}
	return u, nil
}

func notAdminTarget(p *webx.Principal, target AdminUser) error {
	if target.IsPlatformAdmin && p.UserID != target.ID {
		return webx.NewForbidden("cannot target another platform admin")
	}
	return nil
}

func (s *UserOpsService) GetUserDetail(ctx context.Context, userID string) (*AdminUserDetail, error) {
	if s.userOps == nil {
		return nil, errUserOpsNotWired()
	}
	u, ok, err := s.userOps.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, webx.NewNotFound("user not found")
	}
	sessions, err := s.userOps.ListSessions(ctx, userID)
	if err != nil {
		return nil, err
	}
	pats, err := s.userOps.ListPATs(ctx, userID)
	if err != nil {
		return nil, err
	}
	workspaces := []AdminUserWorkspace{}
	if s.wsLister != nil {
		if workspaces, err = s.wsLister.ListUserWorkspaces(ctx, userID); err != nil {
			return nil, err
		}
	}
	return &AdminUserDetail{User: u, Sessions: sessions, PATs: pats, Workspaces: workspaces}, nil
}

func (s *UserOpsService) KickUser(ctx context.Context, p *webx.Principal, userID string) error {
	if s.userOps == nil {
		return errUserOpsNotWired()
	}
	u, err := s.targetUser(ctx, userID)
	if err != nil {
		return err
	}
	if err := notAdminTarget(p, u); err != nil {
		return err
	}
	if err := s.userOps.RevokeAllSessions(ctx, userID); err != nil {
		return err
	}
	s.audit(ctx, p, "admin.user_kick", userID, nil)
	return nil
}

func (s *UserOpsService) KickSession(ctx context.Context, p *webx.Principal, userID, sessionID string) error {
	if s.userOps == nil {
		return errUserOpsNotWired()
	}
	u, err := s.targetUser(ctx, userID)
	if err != nil {
		return err
	}
	if err := notAdminTarget(p, u); err != nil {
		return err
	}
	if err := s.userOps.RevokeSessionByID(ctx, userID, sessionID); err != nil {
		return err
	}
	s.audit(ctx, p, "admin.user_session_revoke", userID, map[string]any{"session_id": sessionID})
	return nil
}

func (s *UserOpsService) AdminResetPassword(ctx context.Context, p *webx.Principal, userID string) error {
	if s.userOps == nil {
		return errUserOpsNotWired()
	}
	u, err := s.targetUser(ctx, userID)
	if err != nil {
		return err
	}
	if err := notAdminTarget(p, u); err != nil {
		return err
	}
	if err := s.userOps.SendPasswordReset(ctx, u.Email); err != nil {
		return err
	}
	s.audit(ctx, p, "admin.user_password_reset", userID, map[string]any{"target_email": u.Email})
	return nil
}

func (s *UserOpsService) ResendVerification(ctx context.Context, p *webx.Principal, userID string) error {
	if s.userOps == nil {
		return errUserOpsNotWired()
	}
	u, err := s.targetUser(ctx, userID)
	if err != nil {
		return err
	}
	if u.EmailVerified {
		return webx.NewConflict("email already verified")
	}
	if err := s.userOps.ResendEmailVerification(ctx, userID, u.Email); err != nil {
		return err
	}
	s.audit(ctx, p, "admin.user_verification_resend", userID, map[string]any{"target_email": u.Email})
	return nil
}

func (s *UserOpsService) MarkVerified(ctx context.Context, p *webx.Principal, userID string) error {
	if s.userOps == nil {
		return errUserOpsNotWired()
	}
	u, err := s.targetUser(ctx, userID)
	if err != nil {
		return err
	}
	if u.EmailVerified {
		return nil
	}
	if err := s.userOps.MarkEmailVerified(ctx, userID); err != nil {
		return err
	}
	s.audit(ctx, p, "admin.user_mark_verified", userID, nil)
	return nil
}

func (s *UserOpsService) ListUserPATs(ctx context.Context, userID string) ([]AdminPAT, error) {
	if s.userOps == nil {
		return nil, errUserOpsNotWired()
	}
	if _, err := s.targetUser(ctx, userID); err != nil {
		return nil, err
	}
	return s.userOps.ListPATs(ctx, userID)
}

func (s *UserOpsService) ExportUserdata(ctx context.Context, _ *webx.Principal, userID string) (map[string]any, error) {
	if _, err := s.targetUser(ctx, userID); err != nil {
		return nil, err
	}
	return s.admin.repo.ExportUserdata(ctx, userID)
}

func (s *UserOpsService) RevokeUserPAT(ctx context.Context, p *webx.Principal, userID, patID string) error {
	if s.userOps == nil {
		return errUserOpsNotWired()
	}
	u, err := s.targetUser(ctx, userID)
	if err != nil {
		return err
	}
	if err := notAdminTarget(p, u); err != nil {
		return err
	}
	if err := s.userOps.RevokePAT(ctx, userID, patID); err != nil {
		return err
	}
	s.audit(ctx, p, "admin.user_pat_revoke", userID, map[string]any{"pat_id": patID})
	return nil
}

func (s *UserOpsService) AdminDeleteUser(ctx context.Context, p *webx.Principal, userID, confirmEmail string) error {
	if s.userOps == nil {
		return errUserOpsNotWired()
	}
	if p.UserID == userID {
		return webx.NewValidation("cannot delete yourself")
	}
	u, err := s.targetUser(ctx, userID)
	if err != nil {
		return err
	}
	if u.IsPlatformAdmin {
		return webx.NewForbidden("cannot delete another platform admin")
	}
	if !strings.EqualFold(strings.TrimSpace(confirmEmail), u.Email) {
		return webx.NewValidation("confirm email does not match target user email")
	}
	if err := s.userOps.DeleteAccount(ctx, p.Email, userID); err != nil {
		return err
	}
	s.audit(ctx, p, "admin.user_delete", userID, map[string]any{"target_email": u.Email})
	return nil
}
