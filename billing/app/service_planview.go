package app

import (
	"context"

	"github.com/haozing/ploykit/billing/domain"
)

type PlanView struct {
	Code      string         `json:"code"`
	Name      string         `json:"name"`
	Currency  string         `json:"currency"`
	TrialDays int            `json:"trial_days"`
	SortNo    int            `json:"sort_no"`
	Limits    map[string]int `json:"limits"`
}

func planView(p domain.Plan) PlanView {
	return PlanView{
		Code:      p.Code,
		Name:      p.Name,
		Currency:  p.Currency,
		TrialDays: p.Limits["trial_days"],
		SortNo:    p.SortNo,
		Limits:    p.Limits,
	}
}

func (s *BillingService) ListPlanViews(ctx context.Context) ([]PlanView, error) {
	plans, err := s.repo.ListPlans(ctx)
	if err != nil {
		return nil, err
	}
	views := make([]PlanView, 0, len(plans))
	for _, p := range plans {
		views = append(views, planView(p))
	}
	return views, nil
}
