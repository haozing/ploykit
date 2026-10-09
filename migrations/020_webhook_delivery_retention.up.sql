

ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_subscription_id_fkey;
ALTER TABLE webhook_delivery ALTER COLUMN subscription_id DROP NOT NULL;
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_subscription_id_fkey
    FOREIGN KEY (subscription_id) REFERENCES webhook_subscription(id) ON DELETE SET NULL;
