package app

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

var knownChannelNames = []string{"stripe"}

const keyNotConfigured = "未配置"

const keyMaskUnavailable = "—"

func (s *BillingService) BillingConfig(_ context.Context) BillingConfigView {
	names := s.channels.Names()
	sort.Strings(names)
	channels := make([]ChannelConfigView, 0, len(names)+len(knownChannelNames))
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		seen[name] = true
		v := ChannelConfigView{Name: name, Configured: true, KeyMasked: keyMaskUnavailable}
		if ch, ok := s.channels.Get(name); ok {
			if viewer, ok := ch.(ChannelConfigViewer); ok {
				info := viewer.ChannelConfig()
				v.Configured = info.Configured
				v.WebhookConfigured = info.WebhookConfigured
				if info.KeyMasked != "" {
					v.KeyMasked = info.KeyMasked
				}
			}
		}
		if !v.Configured {
			v.KeyMasked = keyNotConfigured
		}
		channels = append(channels, v)
	}
	for _, name := range knownChannelNames {
		if !seen[name] {
			channels = append(channels, ChannelConfigView{
				Name: name, Configured: false, KeyMasked: keyNotConfigured,
			})
		}
	}
	return BillingConfigView{Channels: channels}
}

func (s *BillingService) TestChannelConnection(ctx context.Context, name string) error {
	ch, ok := s.channels.Get(name)
	if !ok {
		return webx.NewNotFound("unknown payment channel: " + name)
	}
	if viewer, ok := ch.(ChannelConfigViewer); ok && !viewer.ChannelConfig().Configured {
		return errChannelNotConfigured()
	}
	tester, ok := ch.(ConnectionTester)
	if !ok {
		return webx.NewError(http.StatusBadRequest, CodeChannelTestUnsupported,
			"payment channel does not support connection test: "+name)
	}
	return tester.TestConnection(ctx)
}

func (s *BillingService) AdminCancelSubscription(ctx context.Context, actor *webx.Principal, workspaceID string) error {
	subRef, ok, err := s.repo.GetWorkspaceSubscription(ctx, workspaceID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("workspace not found")
	}
	fromPlan, err := s.repo.GetWorkspacePlan(ctx, workspaceID)
	if err != nil {
		return err
	}
	if subRef == "" && fromPlan == "free" {
		return webx.NewConflict("workspace has no active subscription")
	}

	if subRef != "" {
		ch, err := s.subscriptionChannel(ctx, workspaceID)
		if err != nil {
			return err
		}
		canceller, ok := ch.(SubscriptionCanceller)
		if !ok {
			return webx.NewError(http.StatusBadRequest, CodeChannelCancelUnsupported,
				"payment channel does not support subscription cancel: "+ch.Name())
		}
		if err := canceller.CancelSubscription(ctx, subRef); err != nil {
			return webx.NewError(http.StatusBadGateway, webx.CodeInternal,
				"取消渠道订阅失败，已保持本地状态不变: "+err.Error())
		}
	}

	now := s.now()
	actorLabel := "admin"
	if actor != nil && actor.UserID != "" {
		actorLabel = "admin:" + actor.UserID
	}
	if err := s.repo.ChangeWorkspacePlan(ctx, workspaceID, "free", actorLabel, "admin cancel", now, s.planChangedTx(ctx, workspaceID, "free")); err != nil {
		return err
	}
	if err := s.repo.SetWorkspaceSubscription(ctx, workspaceID, "", time.Time{}, now); err != nil {
		return err
	}
	if s.hooks.OnPlanChanged != nil {
		if err := s.hooks.OnPlanChanged(ctx, workspaceID, fromPlan, "free"); err != nil {
			s.log.Error("OnPlanChanged hook failed", "err", err)
		}
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, &workspaceID, actor, "billing.subscription_canceled", "workspace", workspaceID,
			map[string]any{"admin": true, "subscription_ref": subRef})
	}
	return nil
}

func (s *BillingService) subscriptionChannel(ctx context.Context, workspaceID string) (PaymentChannel, error) {
	orders, err := s.repo.ListOrdersByWorkspace(ctx, workspaceID, 20)
	if err != nil {
		return nil, err
	}
	for _, o := range orders {
		if o.Status != domain.OrderPaid || o.Interval == domain.IntervalOneTime {
			continue
		}
		ch, ok := s.channels.Get(o.Channel)
		if !ok {
			return nil, webx.NewError(http.StatusBadRequest, CodeChannelCancelUnsupported,
				"subscription channel not registered: "+o.Channel)
		}
		return ch, nil
	}
	return nil, webx.NewError(http.StatusBadRequest, CodeChannelCancelUnsupported,
		"cannot locate subscription channel (no paid recurring order)")
}

func (s *BillingAdminService) BillingConfig(ctx context.Context) (BillingConfigView, error) {
	return s.core.BillingConfig(ctx), nil
}

func (s *BillingAdminService) TestChannelConnection(ctx context.Context, name string) error {
	return s.core.TestChannelConnection(ctx, name)
}

func (s *BillingAdminService) AdminCancelSubscription(ctx context.Context, actor *webx.Principal, workspaceID string) error {
	return s.core.AdminCancelSubscription(ctx, actor, workspaceID)
}

func (s *BillingAdminService) MarkOrderPaid(ctx context.Context, actor *webx.Principal, orderID string) error {
	return s.core.MarkOrderPaid(ctx, actor, orderID)
}

func (s *BillingAdminService) ListPlanViews(ctx context.Context) ([]PlanView, error) {
	return s.core.ListPlanViews(ctx)
}
