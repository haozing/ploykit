package app

import (
	"context"
	"errors"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

func (s *BillingService) MarkOrderPaid(ctx context.Context, actor *webx.Principal, orderID string) error {
	order, ok, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("order not found")
	}
	if order.Channel != ChannelManual {
		return webx.NewValidation("only manual orders can be marked paid")
	}
	actorID := ""
	if actor != nil {
		actorID = actor.UserID
	}
	now := s.now()
	emit, err := s.orderMarkedPaidEmitFn(ctx, order, actorID, now)
	if err != nil {
		return err
	}
	if err := s.repo.PayOrder(ctx, orderID, emit, now); err != nil {
		if errors.Is(err, domain.ErrStatusConflict) {
			return webx.NewConflict("order is not pending")
		}
		return err
	}
	s.audit(ctx, &order.WorkspaceID, actor, "billing.order_marked_paid", orderID, map[string]any{"admin": true})
	return nil
}
