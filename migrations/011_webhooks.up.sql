
CREATE TABLE webhook_subscription (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  
  event_types  jsonb NOT NULL DEFAULT '[]',
  
  url          text NOT NULL,
  
  secret       text NOT NULL,
  
  description  text NOT NULL DEFAULT '',
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES "user"(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_sub_ws ON webhook_subscription (workspace_id, is_active);

CREATE TABLE webhook_delivery (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES webhook_subscription(id) ON DELETE CASCADE,
  event_id       text NOT NULL,       
  event_type     text NOT NULL,       
  payload        jsonb NOT NULL,      
  
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts       integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_status_code integer,
  last_error     text,
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_delivery_pending ON webhook_delivery (next_attempt_at) WHERE status = 'pending';

CREATE UNIQUE INDEX uq_webhook_delivery ON webhook_delivery (subscription_id, event_id);
