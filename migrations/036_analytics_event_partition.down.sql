

LOCK TABLE analytics_event IN ACCESS EXCLUSIVE MODE;

CREATE TABLE analytics_event_plain (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  workspace_id  uuid,
  user_id       uuid,
  event_type    text NOT NULL,
  entity_type   text,
  entity_id     text,
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO analytics_event_plain
  (id, workspace_id, user_id, event_type, entity_type, entity_id, payload, created_at)
OVERRIDING SYSTEM VALUE
SELECT id, workspace_id, user_id, event_type, entity_type, entity_id, payload, created_at
  FROM analytics_event;

ALTER TABLE analytics_event RENAME TO analytics_event_old036;
ALTER TABLE analytics_event_plain RENAME TO analytics_event;
DROP TABLE analytics_event_old036; 

ALTER TABLE analytics_event ADD CONSTRAINT analytics_event_pkey PRIMARY KEY (id);
CREATE INDEX idx_analytics_type_time ON analytics_event (event_type, created_at DESC);
CREATE INDEX idx_analytics_ws ON analytics_event (workspace_id, created_at DESC);

DO $$
DECLARE seq text;
BEGIN
  seq := pg_get_serial_sequence('analytics_event', 'id');
  IF seq IS NOT NULL THEN
    PERFORM setval(seq, COALESCE((SELECT MAX(id) FROM analytics_event), 0) + 1, false);
  END IF;
END $$;
