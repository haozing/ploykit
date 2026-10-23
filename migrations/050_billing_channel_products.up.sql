-- BC-7 catalog mapping (F3/F4): catalog-based channels (waffo products,
-- paypal products/plans) need a channel-side product per (plan, interval).
-- The DB plan limits stay the single source of pricing truth;
-- synced_price_cents records what the channel catalog was last synced to so
-- the admin page can flag drift after a plan price change.
CREATE TABLE IF NOT EXISTS billing_channel_products (
    channel            text        NOT NULL,
    plan_code          text        NOT NULL,
    interval           text        NOT NULL,
    channel_product_id text        NOT NULL,
    synced_price_cents bigint      NOT NULL DEFAULT 0,
    synced_at          timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel, plan_code, interval)
);
