package app

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
)

type AdminService struct {
	repo    Repo
	now     Clock
	auditor Auditor
	revoker SessionRevoker
}

func NewAdminService(repo Repo, now Clock) *AdminService {
	return &AdminService{repo: repo, now: now}
}

func (s *AdminService) WithSessionRevoker(r SessionRevoker) *AdminService {
	s.revoker = r
	return s
}

func (s *AdminService) WithAuditor(a Auditor) *AdminService {
	s.auditor = a
	return s
}

func (s *AdminService) CountUsers(ctx context.Context, q, status string) (int, error) {
	return s.repo.CountUsers(ctx, strings.TrimSpace(q), status)
}

func (s *AdminService) CountWorkspaces(ctx context.Context, q string) (int, error) {
	return s.repo.CountWorkspaces(ctx, strings.TrimSpace(q))
}

func (s *AdminService) Stats(ctx context.Context) (*PlatformStats, error) {
	return s.repo.GetStats(ctx)
}

func (s *AdminService) ListUsers(ctx context.Context, q, status string, page, pageSize int) ([]AdminUser, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	q = strings.TrimSpace(q)
	if status != "" && status != "active" && status != "disabled" && status != "deleted" {
		return nil, webx.NewValidation("invalid status filter")
	}
	return s.repo.ListUsers(ctx, q, status, pageSize, (page-1)*pageSize)
}

func (s *AdminService) DisableUser(ctx context.Context, p *webx.Principal, userID string) error {
	if p.UserID == userID {
		return webx.NewValidation("cannot disable yourself")
	}
	if err := s.repo.SetUserStatus(ctx, userID, "disabled"); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("user not found")
		}
		return err
	}
	if s.revoker != nil {
		if err := s.revoker.RevokeAllUserSessions(ctx, userID); err != nil {
			return err
		}
	}

	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.user_disable", "user", userID,
			map[string]any{"user_id": userID})
	}
	return nil
}

func (s *AdminService) EnableUser(ctx context.Context, p *webx.Principal, userID string) error {
	if err := s.repo.SetUserStatus(ctx, userID, "active"); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("user not found")
		}
		return err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.user_enable", "user", userID,
			map[string]any{"user_id": userID})
	}
	return nil
}

func (s *AdminService) SetPlatformAdmin(ctx context.Context, p *webx.Principal, userID string, isAdmin bool) error {
	if p.UserID == userID && !isAdmin {
		return webx.NewValidation("cannot demote yourself")
	}
	if err := s.repo.SetPlatformAdmin(ctx, userID, isAdmin); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("user not found")
		}
		return err
	}

	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.user_role_change", "user", userID,
			map[string]any{"is_admin": isAdmin})
	}
	return nil
}

func (s *AdminService) Impersonate(ctx context.Context, p *webx.Principal, targetID string) (AdminUser, error) {
	if p.ImpersonatedBy != "" {
		return AdminUser{}, webx.NewForbidden("impersonated session cannot impersonate (chain prevention)")
	}
	if p.UserID == targetID {
		return AdminUser{}, webx.NewValidation("cannot impersonate yourself")
	}
	target, ok, err := s.repo.GetUserByID(ctx, targetID)
	if err != nil {
		return AdminUser{}, err
	}
	if !ok {
		return AdminUser{}, webx.NewNotFound("user not found")
	}
	if target.IsPlatformAdmin {
		return AdminUser{}, webx.NewForbidden("cannot impersonate another platform admin")
	}
	if target.Status != "active" {
		return AdminUser{}, webx.NewForbidden("target user is not active")
	}
	return target, nil
}

func (s *AdminService) ListWorkspaces(ctx context.Context, q string, page, pageSize int) ([]AdminWorkspace, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	return s.repo.ListWorkspaces(ctx, strings.TrimSpace(q), pageSize, (page-1)*pageSize)
}

func (s *AdminService) ChangePlan(ctx context.Context, p *webx.Principal, workspaceID, toPlan string) error {

	if ok, err := s.repo.PlanExists(ctx, toPlan); err != nil {
		return err
	} else if !ok {
		return webx.NewValidation("unknown plan_code: " + toPlan)
	}
	from, err := s.repo.ChangePlan(ctx, workspaceID, toPlan, p.Email, "admin manual", s.now())
	if err != nil {
		return err
	}

	if s.auditor != nil {
		s.auditor.Record(ctx, &workspaceID, p, "admin.plan_change", "workspace", workspaceID,
			map[string]any{"from": from, "to": toPlan})
	}
	return nil
}

func (s *AdminService) ListAudit(ctx context.Context, workspaceID string, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.ListAudit(ctx, workspaceID, limit)
}

func (s *AdminService) QueryAudit(ctx context.Context, q audit.ListQuery, actor string) ([]AuditEntry, int, error) {
	ids, err := s.resolveAuditActor(ctx, &q, actor)
	if err != nil {
		return nil, 0, err
	}
	if ids != nil && len(ids) == 0 {
		return []AuditEntry{}, 0, nil
	}
	if len(ids) > 0 {
		return s.repo.QueryAuditExt(ctx, q, ids)
	}
	return s.repo.QueryAudit(ctx, q)
}

const auditActorIDsMax = 50

func (s *AdminService) resolveAuditActor(ctx context.Context, q *audit.ListQuery, actor string) ([]string, error) {
	actor = strings.TrimSpace(actor)
	if actor == "" || q.ActorID != "" {
		return nil, nil
	}
	if _, err := uuid.Parse(actor); err == nil {
		q.ActorID = actor
		return nil, nil
	}
	ids, err := s.repo.UserIDsByEmailPrefix(ctx, actor, auditActorIDsMax)
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, nil
}

func (s *AdminService) CountAudit(ctx context.Context, q audit.ListQuery, actor string) (int, error) {
	ids, err := s.resolveAuditActor(ctx, &q, actor)
	if err != nil {
		return 0, err
	}
	if ids != nil && len(ids) == 0 {
		return 0, nil
	}
	q.Limit, q.Offset = 1, 0
	if len(ids) > 0 {
		_, total, err := s.repo.QueryAuditExt(ctx, q, ids)
		return total, err
	}
	_, total, err := s.repo.QueryAudit(ctx, q)
	return total, err
}

func (s *AdminService) ExportAuditCSV(ctx context.Context, q audit.ListQuery, actor string, maxRows int, w io.Writer) (bool, error) {
	ids, err := s.resolveAuditActor(ctx, &q, actor)
	if err != nil {
		return false, err
	}
	return s.repo.ExportAuditCSV(ctx, q, ids, maxRows, w)
}

func (s *AdminService) AnalyticsSummary(ctx context.Context, since time.Time) ([]AnalyticsSummary, error) {
	return s.repo.AnalyticsSummary(ctx, since)
}
