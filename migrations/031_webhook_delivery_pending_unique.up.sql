

DROP INDEX uq_webhook_delivery;

CREATE UNIQUE INDEX uq_webhook_delivery
  ON webhook_delivery (subscription_id, event_id)
  WHERE status = 'pending';
