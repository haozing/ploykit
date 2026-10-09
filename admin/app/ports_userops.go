package app

import (
	"context"
	"time"
)

type UserSession struct {
	ID         string     `json:"id"`
	Device     string     `json:"device"`
	IPHash     string     `json:"ip_hash"`
	CreatedAt  time.Time  `json:"created_at"`
	LastSeenAt time.Time  `json:"last_seen_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
}

type AdminPAT struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
}

type AdminUserWorkspace struct {
	ID        string    `json:"id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type AdminUserDetail struct {
	User       AdminUser            `json:"user"`
	Sessions   []UserSession        `json:"sessions"`
	PATs       []AdminPAT           `json:"pats"`
	Workspaces []AdminUserWorkspace `json:"workspaces"`
}

type UserDetailProvider interface {
	GetUser(ctx context.Context, userID string) (AdminUser, bool, error)

	ListSessions(ctx context.Context, userID string) ([]UserSession, error)

	RevokeAllSessions(ctx context.Context, userID string) error

	RevokeSessionByID(ctx context.Context, userID, sessionID string) error

	SendPasswordReset(ctx context.Context, email string) error

	ResendEmailVerification(ctx context.Context, userID, email string) error

	MarkEmailVerified(ctx context.Context, userID string) error

	ListPATs(ctx context.Context, userID string) ([]AdminPAT, error)

	RevokePAT(ctx context.Context, userID, patID string) error

	DeleteAccount(ctx context.Context, actorEmail, userID string) error
}

type WorkspaceLister interface {
	ListUserWorkspaces(ctx context.Context, userID string) ([]AdminUserWorkspace, error)
}
