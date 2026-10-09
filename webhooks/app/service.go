package app

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/haozing/ploykit/platform/egressx"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/webhooks"
)

type WebhookService struct {
	repo    Repo
	catalog *EventCatalog
	log     *slog.Logger
	now     Clock

	HTTPClient *http.Client

	targetGuard *egressx.Guard

	hooks webhooks.WebhookHooks

	secrets Secrets
}

func NewWebhookService(repo Repo, catalog *EventCatalog, log *slog.Logger, now Clock) *WebhookService {
	if log == nil {
		log = slog.Default()
	}
	var allowCIDRs []string
	if envAllowsPrivateTarget() {
		allowCIDRs = egressx.PrivateAllowCIDRs()
	}
	client, err := egressx.NewHTTPClient(egressx.Opts{Timeout: 10 * time.Second, AllowCIDRs: allowCIDRs})
	if err != nil {

		panic("webhooks: egress client: " + err.Error())
	}
	return &WebhookService{
		repo:        repo,
		catalog:     catalog,
		log:         log,
		now:         now,
		HTTPClient:  client,
		targetGuard: egressx.GuardOf(client),
		secrets:     noneSecrets{},
	}
}

func (s *WebhookService) WithSecrets(sec Secrets) *WebhookService {
	if sec != nil {
		s.secrets = sec
	}
	return s
}

func (s *WebhookService) WithHTTPClient(c *http.Client) *WebhookService {
	if c != nil && c.Timeout <= 0 {
		cp := *c
		cp.Timeout = 10 * time.Second
		c = &cp
		s.log.Warn("webhooks: injected HTTP client has no Timeout; defaulting to 10s (WH10)")
	}
	s.HTTPClient = c
	s.targetGuard = egressx.GuardOf(c)
	return s
}

func (s *WebhookService) WithHooks(h webhooks.WebhookHooks) *WebhookService {
	s.hooks = h
	return s
}

func (s *WebhookService) Catalog() *EventCatalog { return s.catalog }

func (s *WebhookService) CreateSubscription(ctx context.Context, workspaceID, url, description string, eventTypes []string) (Subscription, string, error) {
	if err := s.validateTarget(ctx, url); err != nil {
		return Subscription{}, "", webx.NewValidation(err.Error())
	}

	for _, et := range eventTypes {
		if !s.catalog.Has(et) {
			return Subscription{}, "", webx.NewValidation("unknown event type: " + et)
		}
	}
	secret, err := MintSecret()
	if err != nil {
		return Subscription{}, "", err
	}

	sealed, err := s.secrets.Seal(secret)
	if err != nil {
		return Subscription{}, "", err
	}
	sub, err := s.repo.CreateSubscription(ctx, Subscription{
		WorkspaceID: workspaceID,
		EventTypes:  eventTypes,
		URL:         url,
		Description: description,
		IsActive:    true,
	}, sealed)
	if err != nil {
		return Subscription{}, "", err
	}
	return sub, secret, nil
}

func (s *WebhookService) ListSubscriptions(ctx context.Context, workspaceID string) ([]Subscription, error) {
	return s.repo.ListSubscriptions(ctx, workspaceID)
}

func (s *WebhookService) GetSubscription(ctx context.Context, workspaceID, id string) (Subscription, bool, error) {
	return s.repo.GetSubscription(ctx, workspaceID, id)
}

func (s *WebhookService) DeleteSubscription(ctx context.Context, workspaceID, id string) error {
	return s.repo.DeleteSubscription(ctx, workspaceID, id)
}

func (s *WebhookService) SetSubscriptionActive(ctx context.Context, workspaceID, subscriptionID string, active bool) error {
	if err := s.repo.SetSubscriptionActive(ctx, workspaceID, subscriptionID, active, s.now()); err != nil {
		return err
	}
	if !active && s.hooks.OnSubscriptionDisabled != nil {

		if err := s.hooks.OnSubscriptionDisabled(ctx, workspaceID, subscriptionID); err != nil {
			s.log.Warn("webhooks: OnSubscriptionDisabled hook failed",
				"err", err, "workspace_id", workspaceID, "subscription_id", subscriptionID)
		}
	}
	return nil
}

func (s *WebhookService) RotateSecret(ctx context.Context, workspaceID, subscriptionID string) (string, error) {
	secret, err := MintSecret()
	if err != nil {
		return "", err
	}

	sealed, err := s.secrets.Seal(secret)
	if err != nil {
		return "", err
	}
	now := s.now()
	if err := s.repo.RotateSecret(ctx, workspaceID, subscriptionID, sealed, now.Add(OldSecretTTL), now); err != nil {
		return "", err
	}
	return secret, nil
}

func (s *WebhookService) Ping(ctx context.Context, workspaceID, subscriptionID string) error {
	sub, ok, err := s.repo.GetSubscription(ctx, workspaceID, subscriptionID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	if !sub.IsActive {
		return webx.NewConflict("subscription is paused")
	}
	return s.repo.EnqueuePing(ctx, workspaceID, subscriptionID)
}

func (s *WebhookService) ListDeliveries(ctx context.Context, workspaceID string, limit int) ([]Delivery, error) {
	return s.repo.ListDeliveries(ctx, workspaceID, limit)
}

func (s *WebhookService) Redeliver(ctx context.Context, workspaceID, deliveryID string) (Delivery, error) {
	return s.repo.Redeliver(ctx, workspaceID, deliveryID)
}

func (s *WebhookService) Emit(ctx context.Context, workspaceID string, event OutboundEvent) (int, error) {
	if !s.catalog.Has(event.Type) {
		return 0, fmt.Errorf("event type not registered: %s", event.Type)
	}
	return s.repo.EmitForEvent(ctx, workspaceID, event)
}

func (s *WebhookService) DeliverPending(ctx context.Context, batchSize int) {
	pending, err := s.repo.ClaimPending(ctx, batchSize)
	if err != nil {
		s.log.Error("webhook claim failed", "err", err)
		return
	}
	for _, d := range pending {
		secret, err := s.secrets.Unseal(d.Secret)
		if err != nil {
			now := s.now()
			nextAt, dead := retryPlan(d.Attempts, now)
			s.markRetry(ctx, d, 0, "secret unseal failed: "+err.Error(), nextAt, dead)
			continue
		}
		d.Secret = secret
		if d.OldSealed != "" && d.OldExpiresAt != nil && s.now().Before(*d.OldExpiresAt) {
			if old, err := s.secrets.Unseal(d.OldSealed); err == nil {
				d.OldPlain = old
			} else {
				s.log.Warn("webhook old-secret unseal failed; sending without X-Signature-Old",
					"err", err, "delivery_id", d.DeliveryID, "subscription_id", d.SubscriptionID)
			}
		}
		s.deliverOne(ctx, d)
	}
}

func retryPlan(attempts int, now time.Time) (nextAt time.Time, dead bool) {
	idx := max(0, min(attempts-1, len(RetryBackoff)-1))
	return now.Add(jitterBackoff(RetryBackoff[idx])), attempts > len(RetryBackoff)
}

func jitterBackoff(d time.Duration) time.Duration {
	return time.Duration(float64(d) * (0.8 + 0.4*rand.Float64()))
}

func (s *WebhookService) markRetry(ctx context.Context, d PendingDelivery, statusCode int, errMsg string, nextAt time.Time, dead bool) {
	if err := s.repo.MarkRetry(ctx, d.DeliveryID, statusCode, errMsg, nextAt, dead); err != nil {
		s.log.Error("webhook mark-retry failed", "err", err,
			"delivery_id", d.DeliveryID, "subscription_id", d.SubscriptionID)
	}
	if dead && s.hooks.OnDeliveryFailed != nil {
		if err := s.hooks.OnDeliveryFailed(ctx, d.WorkspaceID, d.SubscriptionID, d.DeliveryID, d.EventType, errMsg); err != nil {
			s.log.Warn("webhooks: OnDeliveryFailed hook failed",
				"err", err, "delivery_id", d.DeliveryID, "subscription_id", d.SubscriptionID)
		}
	}
	if dead {
		s.maybeAutoDisable(ctx, d)
	}
}

func (s *WebhookService) maybeAutoDisable(ctx context.Context, d PendingDelivery) {
	ff, err := s.repo.FirstFailureAt(ctx, d.SubscriptionID)
	if err != nil {
		s.log.Error("webhook auto-disable window check failed", "err", err,
			"subscription_id", d.SubscriptionID, "delivery_id", d.DeliveryID)
		return
	}
	if ff == nil || s.now().Sub(*ff) < AutoDisableWindow {
		return
	}
	s.log.Warn("webhooks: auto-disabling subscription after continuous failures",
		"workspace_id", d.WorkspaceID, "subscription_id", d.SubscriptionID,
		"first_failure_at", *ff, "window", AutoDisableWindow)
	if err := s.SetSubscriptionActive(ctx, d.WorkspaceID, d.SubscriptionID, false); err != nil {
		s.log.Error("webhook auto-disable failed", "err", err,
			"workspace_id", d.WorkspaceID, "subscription_id", d.SubscriptionID)
	}
}

func (s *WebhookService) deliverOne(ctx context.Context, d PendingDelivery) {
	now := s.now()

	if err := s.validateTarget(ctx, d.URL); err != nil {
		s.markRetry(ctx, d, 0, "target rejected: "+err.Error(), now, true)
		return
	}
	req, err := http.NewRequest(http.MethodPost, d.URL, bytes.NewReader(d.Payload))
	if err != nil {
		nextAt, dead := retryPlan(d.Attempts, now)
		s.markRetry(ctx, d, 0, err.Error(), nextAt, dead)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Signature", Sign(d.Secret, now, d.Payload))

	if d.OldPlain != "" {
		req.Header.Set("X-Signature-Old", Sign(d.OldPlain, now, d.Payload))
	}
	req.Header.Set("X-Timestamp", now.Format(time.RFC3339Nano))
	req.Header.Set("X-Event-Id", d.EventID)
	req.Header.Set("X-Event-Type", d.EventType)
	req.Header.Set("X-Delivery-Id", d.DeliveryID)

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		nextAt, dead := retryPlan(d.Attempts, now)
		s.markRetry(ctx, d, 0, err.Error(), nextAt, dead)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {

		if err := s.repo.MarkDelivered(ctx, d.DeliveryID, resp.StatusCode, now); err != nil {
			s.log.Error("webhook mark-delivered failed", "err", err,
				"delivery_id", d.DeliveryID, "subscription_id", d.SubscriptionID)
		}
		return
	}

	if resp.Header.Get(AbortHeader) == AbortHeaderValue {
		s.markRetry(ctx, d, resp.StatusCode, "receiver requested abort", now, true)
		return
	}

	nextAt, dead := retryPlan(d.Attempts, now)
	s.markRetry(ctx, d, resp.StatusCode, fmt.Sprintf("HTTP %d", resp.StatusCode), nextAt, dead)
}
