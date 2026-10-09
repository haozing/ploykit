package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

type Meter struct {
	Slug        string `json:"slug"`
	DisplayName string `json:"display_name"`

	AggType string `json:"agg_type"`

	Unit      string    `json:"unit,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

var ErrMeterImmutable = errors.New("meter definition immutable")

var meterAggTypes = map[string]bool{
	"sum": true, "count": true, "unique_count": true, "latest": true,
}

type MeterRegistry interface {
	RegisterMeter(ctx context.Context, m Meter) error
	ListMeters(ctx context.Context) ([]Meter, error)
	GetMeter(ctx context.Context, slug string) (Meter, bool, error)
}

func (s *BillingService) WithMeterRegistry(r MeterRegistry) *BillingService {
	s.meters = r
	return s
}

func (s *BillingService) RegisterMeter(ctx context.Context, m Meter) error {
	if s.meters == nil {
		return webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "meter registry not wired")
	}
	if m.Slug == "" {
		return webx.NewValidation("meter slug required")
	}
	if m.DisplayName == "" {
		return webx.NewValidation("meter display_name required")
	}
	if !meterAggTypes[m.AggType] {
		return webx.NewValidation("meter agg_type must be one of sum/count/unique_count/latest")
	}
	return s.meters.RegisterMeter(ctx, m)
}

func (s *BillingService) ListMeters(ctx context.Context) ([]Meter, error) {
	if s.meters == nil {
		return nil, webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "meter registry not wired")
	}
	return s.meters.ListMeters(ctx)
}

func (s *BillingService) GetMeter(ctx context.Context, slug string) (Meter, bool, error) {
	if s.meters == nil {
		return Meter{}, false, webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "meter registry not wired")
	}
	return s.meters.GetMeter(ctx, slug)
}
