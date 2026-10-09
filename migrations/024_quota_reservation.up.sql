

CREATE TABLE quota_reservation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  quota_key       text NOT NULL,
  
  period_key      text NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  settled_amount  bigint NOT NULL DEFAULT 0,
  
  released_amount bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'reserved'
                  CHECK (status IN ('reserved', 'settled', 'released', 'expired')),
  
  idempotency_key text NOT NULL,
  
  settle_idempotency_key text,
  
  release_idempotency_keys text[] NOT NULL DEFAULT '{}',
  
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  released_at     timestamptz,
  UNIQUE (workspace_id, quota_key, idempotency_key)
);

CREATE INDEX idx_quota_reservation_expiry ON quota_reservation (expires_at)
  WHERE status = 'reserved';

CREATE INDEX idx_quota_reservation_active ON quota_reservation (workspace_id, period_key, quota_key)
  WHERE status = 'reserved';

ALTER TABLE quota_counter ADD COLUMN reserved bigint NOT NULL DEFAULT 0;
