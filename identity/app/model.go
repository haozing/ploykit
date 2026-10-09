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
}

var ErrDuplicate = errors.New("duplicate")

var ErrNotFound = errors.New("not found")

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
