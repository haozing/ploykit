package app

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

type Preference struct {
	NotificationType string    `json:"notification_type"`
	EmailEnabled     bool      `json:"email_enabled"`
	InAppEnabled     bool      `json:"in_app_enabled"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type PrefGate interface {
	List(ctx context.Context, userID string) ([]Preference, error)

	Upsert(ctx context.Context, userID, typ string, email, inApp *bool) (Preference, error)

	Allowed(ctx context.Context, userID, typ string) (bool, error)

	EmailAllowed(ctx context.Context, userID, typ string) (bool, error)
}

func (s *NotifyService) WithPrefGate(gate PrefGate) *NotifyService {
	s.prefs = gate
	return s
}

func (s *NotifyService) ListPreferences(ctx context.Context, userID string) ([]Preference, error) {
	if s.prefs == nil {
		return []Preference{}, nil
	}
	return s.prefs.List(ctx, userID)
}

func (s *NotifyService) UpsertPreference(ctx context.Context, userID, typ string, email, inApp *bool) (Preference, error) {
	if typ == "" || len(typ) > 64 {
		return Preference{}, webx.NewValidation("notification type required (<=64 chars)")
	}
	if email == nil && inApp == nil {
		return Preference{}, webx.NewValidation("at least one of email_enabled / in_app_enabled is required")
	}
	if s.prefs == nil {
		return Preference{}, webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "notification preferences not configured")
	}
	return s.prefs.Upsert(ctx, userID, typ, email, inApp)
}

func (s *NotifyService) inAppAllowed(ctx context.Context, userID, typ string) bool {
	if s.prefs == nil {
		return true
	}
	ok, err := s.prefs.Allowed(ctx, userID, typ)
	if err != nil {
		slog.Warn("notify: preference gate failed, allowing", "err", err, "user_id", userID, "type", typ)
		return true
	}
	return ok
}

func (s *NotifyService) emailAllowed(ctx context.Context, userID, typ string) bool {
	if s.prefs == nil {
		return true
	}
	ok, err := s.prefs.EmailAllowed(ctx, userID, typ)
	if err != nil {
		slog.Warn("notify: email preference gate failed, allowing", "err", err, "user_id", userID, "type", typ)
		return true
	}
	return ok
}
