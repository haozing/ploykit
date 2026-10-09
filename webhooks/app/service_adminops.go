package app

import (
	"context"
	"net/http"

	"github.com/haozing/ploykit/platform/webx"
)

type DeliveryFilter struct {
	WorkspaceID string
	Status      string
}

type AdminDeliveryView struct {
	Delivery
	WorkspaceID string `json:"workspace_id"`
	URL         string `json:"url"`
}

type AdminRepo interface {
	ListAllDeliveries(ctx context.Context, f DeliveryFilter, limit, offset int) ([]AdminDeliveryView, int, error)

	AdminRedeliver(ctx context.Context, deliveryID string) (AdminDeliveryView, error)
}

func (s *WebhookService) adminRepo() (AdminRepo, error) {
	ar, ok := s.repo.(AdminRepo)
	if !ok {
		return nil, webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "webhook admin repo not wired")
	}
	return ar, nil
}

func (s *WebhookService) ListAllDeliveries(ctx context.Context, f DeliveryFilter, limit, offset int) ([]AdminDeliveryView, int, error) {
	ar, err := s.adminRepo()
	if err != nil {
		return nil, 0, err
	}
	if f.Status != "" && f.Status != StatusPending && f.Status != StatusDelivered && f.Status != StatusDead {
		return nil, 0, webx.NewValidation("invalid status filter")
	}
	return ar.ListAllDeliveries(ctx, f, limit, offset)
}

func (s *WebhookService) AdminRedeliver(ctx context.Context, deliveryID string) (AdminDeliveryView, error) {
	ar, err := s.adminRepo()
	if err != nil {
		return AdminDeliveryView{}, err
	}
	return ar.AdminRedeliver(ctx, deliveryID)
}
