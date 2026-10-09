

DROP INDEX uq_webhook_delivery;

DELETE FROM webhook_delivery d
USING webhook_delivery newer
WHERE d.subscription_id = newer.subscription_id
  AND d.event_id = newer.event_id
  AND (d.created_at, d.ctid) < (newer.created_at, newer.ctid);

CREATE UNIQUE INDEX uq_webhook_delivery ON webhook_delivery (subscription_id, event_id);
