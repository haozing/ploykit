package app

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
)

var ErrNotFound = errors.New("admin: target user not found")

type PlatformStats struct {
	TotalUsers      int `json:"total_users"`
	ActiveUsers     int `json:"active_users"`
	TotalWorkspaces int `json:"total_workspaces"`
	PaidWorkspaces  int `json:"paid_workspaces"`
	NewUsers7d      int `json:"new_users_7d"`
	NewUsers30d     int `json:"new_users_30d"`
}

type AdminUser struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	DisplayName     string     `json:"display_name"`
	Status          string     `json:"status"`
	IsPlatformAdmin bool       `json:"is_platform_admin"`
	EmailVerified   bool       `json:"email_verified"`
	CreatedAt       time.Time  `json:"created_at"`
	LastLoginAt     *time.Time `json:"last_login_at,omitempty"`
}

type AdminWorkspace struct {
	ID         string    `json:"id"`
	Slug       string    `json:"slug"`
	Name       string    `json:"name"`
	PlanCode   string    `json:"plan_code"`
	MemberCnt  int       `json:"member_count"`
	OwnerEmail *string   `json:"owner_email,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

type AuditEntry struct {
	ID            string         `json:"id"`
	WorkspaceID   string         `json:"workspace_id,omitempty"`
	ActorType     string         `json:"actor_type"`
	ActorID       string         `json:"actor_id,omitempty"`
	ActorSnapshot map[string]any `json:"actor_snapshot"`
	Action        string         `json:"action"`
	ResourceType  string         `json:"resource_type"`
	ResourceID    string         `json:"resource_id,omitempty"`
	Metadata      map[string]any `json:"metadata"`
	CreatedAt     time.Time      `json:"created_at"`
}

type AnalyticsSummary struct {
	EventType string    `json:"event_type"`
	Count     int       `json:"count"`
	LastAt    time.Time `json:"last_at"`
}

type Clock func() time.Time

type Auditor interface {
	Record(ctx context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any)
}

type Repo interface {
	GetStats(ctx context.Context) (*PlatformStats, error)

	ListUsers(ctx context.Context, q, status string, limit, offset int) ([]AdminUser, error)

	CountUsers(ctx context.Context, q, status string) (int, error)

	SetUserStatus(ctx context.Context, userID, status string) error
	SetPlatformAdmin(ctx context.Context, userID string, isAdmin bool) error
	GetUserByID(ctx context.Context, userID string) (AdminUser, bool, error)

	ListWorkspaces(ctx context.Context, q string, limit, offset int) ([]AdminWorkspace, error)

	CountWorkspaces(ctx context.Context, q string) (int, error)

	GetWorkspaceByID(ctx context.Context, id string) (AdminWorkspace, bool, error)

	ListWorkspaceMembers(ctx context.Context, workspaceID string) ([]WsMember, error)

	ChangePlan(ctx context.Context, workspaceID, toPlan, actor, reason string, now time.Time) (fromPlan string, err error)

	PlanExists(ctx context.Context, code string) (bool, error)

	ListAudit(ctx context.Context, workspaceID string, limit int) ([]AuditEntry, error)

	QueryAudit(ctx context.Context, q audit.ListQuery) ([]AuditEntry, int, error)

	UserIDsByEmailPrefix(ctx context.Context, emailPrefix string, limit int) ([]string, error)

	QueryAuditExt(ctx context.Context, q audit.ListQuery, actorIDs []string) ([]AuditEntry, int, error)

	ExportAuditCSV(ctx context.Context, q audit.ListQuery, actorIDs []string, maxRows int, w io.Writer) (truncated bool, err error)

	ExportUserdata(ctx context.Context, userID string) (map[string]any, error)

	ListSSOProviders(ctx context.Context) ([]SSOProviderRow, error)

	AnalyticsSummary(ctx context.Context, since time.Time) ([]AnalyticsSummary, error)
}

type SessionRevoker interface {
	RevokeAllUserSessions(ctx context.Context, userID string) error
}
