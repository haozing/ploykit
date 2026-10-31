package app

import (
	"errors"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

type User struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	Status      string `json:"status"`

	IsPlatformAdmin bool `json:"is_platform_admin"`
	EmailVerified   bool `json:"email_verified"`

	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`

	// UpdatedBy is the last human modifier (self-edit = the user themself;
	// nil for system paths). The audit-trail echo for profile changes.
	UpdatedBy string `json:"updated_by,omitempty"`
}

var ErrDuplicate = errors.New("duplicate")

var ErrNotFound = errors.New("not found")

// ErrOAuthLinkConflict：同一 (provider, subject) 已绑到另一个用户时
// LinkOAuthAccount 拒绝（OA-1 fail-closed）。并发竞态窗口内第二个登录
// 请求会拿到它——登录失败，重试走 FindOAuthAccount 命中既有绑定。
var ErrOAuthLinkConflict = errors.New("oauth account already linked to another user")

type PAT struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`

	Scope *webx.CredentialScope `json:"scope,omitempty"`
}

type Challenge struct {
	ID         string
	Email      string
	Kind       string
	SecretHash string
	Attempts   int
	ExpiresAt  time.Time
	CreatedAt  time.Time
}
