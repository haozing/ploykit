

CREATE TABLE notification (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  
  link       text,
  
  count      integer NOT NULL DEFAULT 1,
  
  dedup_key  text,
  read_at    timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_notification_dedup ON notification (user_id, dedup_key) WHERE dedup_key IS NOT NULL;

CREATE INDEX idx_notification_inbox ON notification (user_id, read_at, created_at DESC);

CREATE INDEX idx_notification_unread ON notification (user_id) WHERE read_at IS NULL AND archived_at IS NULL;
