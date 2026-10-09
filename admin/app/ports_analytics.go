package app

import (
	"context"
	"time"
)

type AnalyticsEventRow struct {
	ID          int64          `json:"id"`
	WorkspaceID string         `json:"workspace_id,omitempty"`
	UserID      string         `json:"user_id,omitempty"`
	Type        string         `json:"event_type"`
	EntityType  string         `json:"entity_type,omitempty"`
	EntityID    string         `json:"entity_id,omitempty"`
	Payload     map[string]any `json:"payload"`
	CreatedAt   time.Time      `json:"created_at"`
}

type AnalyticsRecentEvents interface {
	Recent(ctx context.Context, eventType string, limit int) ([]AnalyticsEventRow, error)
}

func (s *WsOpsService) RecentEvents(ctx context.Context, eventType string, limit int) ([]AnalyticsEventRow, error) {
	if s.analytics == nil {
		return nil, errNotWired("analytics events")
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return s.analytics.Recent(ctx, eventType, limit)
}
