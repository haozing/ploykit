package app

import "time"

type Workspace struct {
	ID        string    `json:"id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	PlanCode  string    `json:"plan_code"`
	CreatedAt time.Time `json:"created_at"`
}

type WorkspaceMembership struct {
	Workspace
	Role string `json:"role"`
}

type Member struct {
	UserID      string    `json:"user_id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

type Invitation struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type InvitationWithWorkspace struct {
	Invitation
	WorkspaceName string `json:"workspace_name"`
	WorkspaceSlug string `json:"workspace_slug"`
}

type ShareLink struct {
	ID         string    `json:"id"`
	CodePrefix string    `json:"code_prefix"`
	Role       string    `json:"role"`
	MaxUses    int       `json:"max_uses"`
	Uses       int       `json:"uses"`
	ExpiresAt  time.Time `json:"expires_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type Page[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
}

type WorkspaceConfig struct {
	MaxPerUser int
}
