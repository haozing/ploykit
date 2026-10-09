package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/platform/webx"
)

type WsOpsService struct {
	*AdminService
	wsOps     WorkspaceAdminOps
	granter   QuotaGranter
	announcer Announcer
	analytics AnalyticsRecentEvents
}

func NewWsOpsService(base *AdminService) *WsOpsService {
	return &WsOpsService{AdminService: base}
}

func (s *WsOpsService) WithWorkspaceOps(ops WorkspaceAdminOps) *WsOpsService {
	s.wsOps = ops
	return s
}

func (s *WsOpsService) WithQuotaGranter(g QuotaGranter) *WsOpsService {
	s.granter = g
	return s
}

func (s *WsOpsService) WithAnnouncer(a Announcer) *WsOpsService {
	s.announcer = a
	return s
}

func (s *WsOpsService) WithAnalyticsEvents(a AnalyticsRecentEvents) *WsOpsService {
	s.analytics = a
	return s
}

func errNotWired(what string) error {
	return webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, what+" not wired")
}

func (s *WsOpsService) GetWorkspaceDetail(ctx context.Context, workspaceID string) (*WsDetail, error) {
	if s.wsOps == nil {
		return nil, errNotWired("workspace ops")
	}
	row, ok, err := s.repo.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, webx.NewNotFound("workspace not found")
	}
	members, err := s.repo.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	return &WsDetail{AdminWorkspace: row, Members: members}, nil
}

func (s *WsOpsService) AdminUpdateMemberRole(ctx context.Context, p *webx.Principal, workspaceID, targetUserID, newRole string) error {
	if s.wsOps == nil {
		return errNotWired("workspace ops")
	}
	if err := s.wsOps.UpdateMemberRole(ctx, p, workspaceID, targetUserID, newRole); err != nil {
		return err
	}

	if s.auditor != nil {
		s.auditor.Record(ctx, &workspaceID, p, "admin.ws_member_role", "member", targetUserID,
			map[string]any{"workspace_id": workspaceID, "to": newRole})
	}
	return nil
}

func (s *WsOpsService) AdminRemoveMember(ctx context.Context, p *webx.Principal, workspaceID, targetUserID string) error {
	if s.wsOps == nil {
		return errNotWired("workspace ops")
	}
	if err := s.wsOps.RemoveMember(ctx, p, workspaceID, targetUserID); err != nil {
		return err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, &workspaceID, p, "admin.ws_member_remove", "member", targetUserID,
			map[string]any{"workspace_id": workspaceID})
	}
	return nil
}

func (s *WsOpsService) AdminDeleteWorkspace(ctx context.Context, p *webx.Principal, workspaceID, confirm string) error {
	if s.wsOps == nil {
		return errNotWired("workspace ops")
	}
	detail, err := s.GetWorkspaceDetail(ctx, workspaceID)
	if err != nil {
		return err
	}
	if confirm != detail.Slug {
		return webx.NewValidation("confirm must equal the workspace slug")
	}
	if err := s.wsOps.DeleteWorkspace(ctx, p, workspaceID); err != nil {
		return err
	}
	if s.auditor != nil {

		s.auditor.Record(ctx, nil, p, "admin.ws_delete", "workspace", workspaceID,
			map[string]any{"slug": detail.Slug, "name": detail.Name, "member_count": detail.MemberCnt})
	}
	return nil
}

func (s *WsOpsService) AdminTransferOwnership(ctx context.Context, p *webx.Principal, workspaceID, newOwnerUserID string) error {
	if s.wsOps == nil {
		return errNotWired("workspace ops")
	}
	if err := s.wsOps.TransferOwnership(ctx, p, workspaceID, newOwnerUserID); err != nil {
		return err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, &workspaceID, p, "admin.ws_owner_transfer", "workspace", workspaceID,
			map[string]any{"workspace_id": workspaceID, "new_owner": newOwnerUserID})
	}
	return nil
}

func (s *WsOpsService) ListSSOProviders(ctx context.Context) ([]SSOProviderRow, error) {
	return s.repo.ListSSOProviders(ctx)
}

func (s *WsOpsService) GrantQuota(ctx context.Context, p *webx.Principal, workspaceID, key, reason, ref string, amount int) error {
	if s.granter == nil {
		return errNotWired("quota granter")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return webx.NewValidation("key required")
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return webx.NewValidation("reason required")
	}
	if amount <= 0 {
		return webx.NewValidation("amount must be positive")
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "manual:" + uuid.NewString()
	}
	unlocked, err := s.granter.Grant(ctx, workspaceID, key, reason, ref, amount, s.now())
	if err != nil {
		return err
	}
	if !unlocked {
		return webx.NewConflict("identical grant already applied (same key/reason/ref)")
	}
	if s.auditor != nil {

		s.auditor.Record(ctx, &workspaceID, p, "admin.quota_grant", "workspace", workspaceID,
			map[string]any{"key": key, "amount": amount, "reason": reason, "ref": ref})
	}
	return nil
}

type AnnouncementRequest struct {
	Target string `json:"target"`
	UserID string `json:"user_id"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	Link   string `json:"link"`
}

const announcementFanoutCap = 1000

func announcementDedup(title, body string, day time.Time) string {
	sum := sha256.Sum256([]byte(body))
	return "announcement:" + title + ":" + hex.EncodeToString(sum[:6]) + ":" + day.UTC().Format("2006-01-02")
}

type AnnouncementResult struct {
	Target string `json:"target"`
	Sent   int    `json:"sent"`
	Failed int    `json:"failed"`
}

func (s *WsOpsService) SendAnnouncement(ctx context.Context, p *webx.Principal, req AnnouncementRequest) (*AnnouncementResult, error) {
	if s.announcer == nil {
		return nil, errNotWired("announcer")
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if req.Title == "" || req.Body == "" {
		return nil, webx.NewValidation("title and body required")
	}
	dedup := announcementDedup(req.Title, req.Body, s.now())
	base := NotifyInput{
		Type:     "announcement",
		Title:    req.Title,
		Body:     req.Body,
		Link:     req.Link,
		DedupKey: dedup,
	}
	res := &AnnouncementResult{Target: req.Target}
	resID := req.Target
	switch req.Target {
	case "user":
		if req.UserID == "" {
			return nil, webx.NewValidation("user_id required when target=user")
		}
		resID = req.UserID
		in := base
		in.UserID = req.UserID
		if err := s.announcer.Notify(ctx, in); err != nil {
			return nil, err
		}
		res.Sent = 1
	case "all":
		ids, err := s.announcer.AllActiveUserIDs(ctx)
		if err != nil {
			return nil, err
		}
		if len(ids) > announcementFanoutCap {
			return nil, webx.NewValidation("too many recipients (>1000); announce in batches")
		}
		for _, id := range ids {
			in := base
			in.UserID = id
			if err := s.announcer.Notify(ctx, in); err != nil {
				res.Failed++
				slog.Warn("announcement fanout failed", "user", id, "err", err)
				continue
			}
			res.Sent++
		}
	default:
		return nil, webx.NewValidation(`target must be "user" or "all"`)
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.announcement", "announcement", resID,
			map[string]any{"target": req.Target, "title": req.Title, "sent": res.Sent, "failed": res.Failed})
	}
	return res, nil
}
