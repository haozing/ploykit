

CREATE TABLE analytics_event (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid,
  user_id       uuid,
  event_type    text NOT NULL,   
  entity_type   text,
  entity_id     text,
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_type_time ON analytics_event (event_type, created_at DESC);
CREATE INDEX idx_analytics_ws ON analytics_event (workspace_id, created_at DESC);
