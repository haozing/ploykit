

CREATE TABLE "order" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES "user"(id),
  plan_code       text NOT NULL REFERENCES plan(code),
  
  interval        text NOT NULL CHECK (interval IN ('monthly', 'yearly', 'one_time')),
  
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  currency        text NOT NULL DEFAULT 'CNY',
  
  channel         text NOT NULL,
  
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'failed', 'canceled', 'refunded')),
  
  channel_ref     text,
  
  metadata        jsonb NOT NULL DEFAULT '{}',
  paid_at         timestamptz,
  canceled_at     timestamptz,
  refunded_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_ws ON "order" (workspace_id, created_at DESC);
CREATE INDEX idx_order_status ON "order" (status, created_at DESC);
CREATE INDEX idx_order_channel_ref ON "order" (channel_ref) WHERE channel_ref IS NOT NULL;

CREATE TABLE payment_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  channel         text NOT NULL,
  channel_event_id text NOT NULL,
  
  event_type      text NOT NULL,
  
  order_id        uuid REFERENCES "order"(id),
  
  payload         jsonb NOT NULL DEFAULT '{}',
  
  process_status  text NOT NULL DEFAULT 'received'
                  CHECK (process_status IN ('received', 'processed', 'ignored', 'error')),
  process_error   text,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, channel_event_id)
);

CREATE INDEX idx_payment_event_pending ON payment_event (created_at) WHERE process_status = 'received';
