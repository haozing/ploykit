package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/platform/redactx"
	"github.com/haozing/ploykit/platform/webx"
)

type Event struct {
	WorkspaceID string
	UserID      string
	Type        string
	EntityType  string
	EntityID    string
	Payload     map[string]any
}

type Repo interface {
	Track(ctx context.Context, e Event, now time.Time)

	RecentByType(ctx context.Context, eventType string, limit int) ([]EventRow, error)

	Recent(ctx context.Context, since time.Time, limit int) ([]EventRow, error)

	CountByType(ctx context.Context, eventType string, since time.Time) (int, error)

	CountByTypeInWorkspace(ctx context.Context, workspaceID, eventType string, since time.Time) (int, error)
}

type EventRow struct {
	ID          int64          `json:"id"`
	WorkspaceID string         `json:"workspace_id,omitempty"`
	UserID      string         `json:"user_id,omitempty"`
	Type        string         `json:"event_type"`
	EntityType  string         `json:"entity_type,omitempty"`
	EntityID    string         `json:"entity_id,omitempty"`
	Payload     map[string]any `json:"payload"`
	CreatedAt   time.Time      `json:"created_at"`
}

type TrackService struct {
	repo Repo
	log  *slog.Logger
	now  func() time.Time
}

func NewTrackService(repo Repo, log *slog.Logger) *TrackService {
	if log == nil {
		log = slog.Default()
	}
	return &TrackService{repo: repo, log: log, now: time.Now}
}

func (s *TrackService) Track(ctx context.Context, e Event) error {
	if err := validateEvent(e); err != nil {
		return err
	}
	e.Payload = redactPayload(e.Payload)
	s.repo.Track(ctx, e, s.now())
	return nil
}

const maxPayloadBytes = 16 << 10

func validateEvent(e Event) error {
	if e.Type == "" {
		return webx.NewValidation("event type required")
	}
	if utf8.RuneCountInString(e.Type) > 64 {
		return webx.NewValidation("event type too long (max 64 chars)")
	}
	if utf8.RuneCountInString(e.EntityType) > 64 {
		return webx.NewValidation("entity_type too long (max 64 chars)")
	}
	if utf8.RuneCountInString(e.EntityID) > 128 {
		return webx.NewValidation("entity_id too long (max 128 chars)")
	}
	if e.WorkspaceID != "" {
		if _, err := uuid.Parse(e.WorkspaceID); err != nil {
			return webx.NewValidation("workspace_id must be a valid UUID when set")
		}
	}
	if e.UserID != "" {
		if _, err := uuid.Parse(e.UserID); err != nil {
			return webx.NewValidation("user_id must be a valid UUID when set")
		}
	}
	if raw, err := json.Marshal(e.Payload); err == nil && len(raw) > maxPayloadBytes {
		return webx.NewValidation("payload too large (max 16KiB serialized)")
	}
	return nil
}

func redactPayload(p map[string]any) map[string]any {
	if p == nil {
		return nil
	}
	if out, ok := redactx.Any(p).(map[string]any); ok {
		return out
	}
	return p
}

func (s *TrackService) RecentByType(ctx context.Context, eventType string, limit int) ([]EventRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.RecentByType(ctx, eventType, limit)
}

const recentWindow = 30 * 24 * time.Hour

func (s *TrackService) Recent(ctx context.Context, limit int) ([]EventRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return s.repo.Recent(ctx, s.now().Add(-recentWindow), limit)
}

func (s *TrackService) CountByType(ctx context.Context, eventType string, since time.Time) (int, error) {
	return s.repo.CountByType(ctx, eventType, since)
}

func (s *TrackService) CountByTypeInWorkspace(ctx context.Context, workspaceID, eventType string, since time.Time) (int, error) {
	return s.repo.CountByTypeInWorkspace(ctx, workspaceID, eventType, since)
}
