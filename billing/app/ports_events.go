package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/events"
)

const (
	KindPaymentFailed = "billing.payment_failed"

	KindOrderMarkedPaid = "billing.order_marked_paid"
)

type EventEmit func(ctx context.Context, tx pgx.Tx, ev events.Event) error

func (s *BillingService) WithEventEmitter(emit EventEmit) *BillingService {
	s.eventEmit = emit
	return s
}

func paymentFailedEvent(order domain.Order, event domain.PaymentEvent, failedAt time.Time) (events.Event, error) {
	ws, err := uuid.Parse(order.WorkspaceID)
	if err != nil {
		return events.Event{}, err
	}
	payload, err := json.Marshal(map[string]any{
		"workspace_id": order.WorkspaceID,
		"order_id":     order.ID,
		"channel":      event.Channel,
		"amount_cents": order.AmountCents,
		"currency":     order.Currency,
		"reason":       "payment failed",
		"failed_at":    failedAt.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return events.Event{}, err
	}
	return events.Event{
		Kind:           KindPaymentFailed,
		WorkspaceID:    ws,
		Payload:        payload,
		IDempotencyKey: KindPaymentFailed + ":" + order.ID,
	}, nil
}

func orderMarkedPaidEvent(order domain.Order, actorID string, markedAt time.Time) (events.Event, error) {
	ws, err := uuid.Parse(order.WorkspaceID)
	if err != nil {
		return events.Event{}, err
	}
	payload, err := json.Marshal(map[string]any{
		"workspace_id": order.WorkspaceID,
		"order_id":     order.ID,
		"channel":      order.Channel,
		"amount_cents": order.AmountCents,
		"currency":     order.Currency,
		"actor_id":     actorID,
		"marked_at":    markedAt.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return events.Event{}, err
	}
	return events.Event{
		Kind:           KindOrderMarkedPaid,
		WorkspaceID:    ws,
		Payload:        payload,
		IDempotencyKey: KindOrderMarkedPaid + ":" + order.ID,
	}, nil
}

func (s *BillingService) paymentFailedEmitFn(ctx context.Context, order domain.Order, event domain.PaymentEvent, now time.Time) (func(pgx.Tx) error, error) {
	if s.eventEmit == nil {
		return nil, nil
	}
	emit := s.eventEmit
	ev, err := paymentFailedEvent(order, event, now)
	if err != nil {
		return nil, err
	}
	return func(tx pgx.Tx) error { return emit(ctx, tx, ev) }, nil
}

func (s *BillingService) orderMarkedPaidEmitFn(ctx context.Context, order domain.Order, actorID string, now time.Time) (func(pgx.Tx) error, error) {
	if s.eventEmit == nil {
		return nil, nil
	}
	emit := s.eventEmit
	ev, err := orderMarkedPaidEvent(order, actorID, now)
	if err != nil {
		return nil, err
	}
	return func(tx pgx.Tx) error { return emit(ctx, tx, ev) }, nil
}
