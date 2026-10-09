package app

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func TestCreateCheckout_PlanCurrency(t *testing.T) {
	cases := []struct {
		name        string
		planCcy     string
		cfgCcy      string
		wantOrderCt string
	}{
		{"plan USD → 订单 USD", "USD", "CNY", "USD"},
		{"plan 空币种 → 回落 cfg EUR", "", "EUR", "EUR"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.plans["pro"] = domain.Plan{Code: "pro", Currency: tc.planCcy,
				Limits: map[string]int{"price_monthly_cents": 9900}}
			var gotOrder domain.Order
			reg := NewChannelRegistry()
			reg.Register(&trialChannel{capture: &gotOrder})
			svc := NewBillingService(repo, reg, Config{Currency: tc.cfgCcy}, BillingHooks{}, nil,
				func() time.Time { return testNow }, nil)

			_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "pro", domain.IntervalMonthly, "trialchan")
			require.NoError(t, err)
			assert.Equal(t, tc.wantOrderCt, gotOrder.Currency)
		})
	}
}

func TestCreateOverageOrder_PlanCurrency(t *testing.T) {
	cases := []struct {
		name    string
		planCcy string
		cfgCcy  string
		wantCcy string
	}{
		{"plan EUR → 超额单 EUR", "EUR", "CNY", "EUR"},
		{"plan 空币种 → 回落 cfg JPY", "", "JPY", "JPY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.plans["meter_e2e"] = domain.Plan{Code: "meter_e2e", Currency: tc.planCcy}
			repo.wsPlan["ws_1"] = "meter_e2e"
			svc := NewBillingService(repo, NewChannelRegistry(), Config{Currency: tc.cfgCcy}, BillingHooks{}, nil,
				func() time.Time { return testNow }, nil)

			order, created, err := svc.CreateOverageOrder(context.Background(), "ws_1", "2026-09",
				[]OverageItem{{Dim: "api_calls", Used: 1100, Included: 1000, UnitCents: 2}}, testNow)
			require.NoError(t, err)
			require.True(t, created)
			assert.Equal(t, tc.wantCcy, order.Currency)
		})
	}
}
