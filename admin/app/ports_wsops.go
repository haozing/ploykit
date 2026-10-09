package app

import (
	"context"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

type WsMember struct {
	UserID      string    `json:"user_id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

type WsDetail struct {
	AdminWorkspace
	Members []WsMember `json:"members"`
}

type WorkspaceAdminOps interface {
	UpdateMemberRole(ctx context.Context, actor *webx.Principal, wsID, targetUserID, newRole string) error
	RemoveMember(ctx context.Context, actor *webx.Principal, wsID, targetUserID string) error
	DeleteWorkspace(ctx context.Context, actor *webx.Principal, wsID string) error

	TransferOwnership(ctx context.Context, actor *webx.Principal, wsID, newOwnerUserID string) error
}

type QuotaGranter interface {
	Grant(ctx context.Context, workspaceID, key, reason, refID string, amount int, now time.Time) (bool, error)
}

type NotifyInput struct {
	UserID string
	Type   string
	Title  string
	Body   string
	Link   string

	DedupKey string
}

type Announcer interface {
	Notify(ctx context.Context, input NotifyInput) error
	AllActiveUserIDs(ctx context.Context) ([]string, error)
}
