-- BC-4 abandoned-checkout sweep (F15): catalog channels like waffo expire a
-- checkout session with ZERO callbacks, so a pending order would hang
-- forever. BillingService persists CheckoutSession.ExpiresAt here next to
-- channel_ref (SetOrderChannelRefAndExpiry, one write at checkout success);
-- the order sweeper then flips pending rows whose expires_at has passed to
-- canceled. NULL = no channel expiry known (legacy rows created before this
-- column, sessions without expiry) — never swept, never blocking.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS expires_at timestamptz;
