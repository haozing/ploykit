

LOCK TABLE analytics_event IN ACCESS EXCLUSIVE MODE;

CREATE TABLE analytics_event_part (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  workspace_id  uuid,
  user_id       uuid,
  event_type    text NOT NULL,
  entity_type   text,
  entity_id     text,
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
  lo_m date;
  hi_m date;
  m date;
BEGIN
  SELECT COALESCE(date_trunc('month', MIN(created_at) AT TIME ZONE 'utc'),
                  date_trunc('month', now() AT TIME ZONE 'utc'))::date
    INTO lo_m FROM analytics_event;
  SELECT GREATEST(
           date_trunc('month', now() AT TIME ZONE 'utc') + interval '2 months',
           COALESCE(date_trunc('month', MAX(created_at) AT TIME ZONE 'utc'),
                    date_trunc('month', now() AT TIME ZONE 'utc')))::date
    INTO hi_m FROM analytics_event;
  m := lo_m;
  WHILE m <= hi_m LOOP
    EXECUTE format(
      'CREATE TABLE analytics_event_%s PARTITION OF analytics_event_part FOR VALUES FROM (''%sT00:00:00+00'') TO (''%sT00:00:00+00'')',
      to_char(m, 'YYYY_MM'), to_char(m, 'YYYY-MM-DD'), to_char(m + interval '1 month', 'YYYY-MM-DD'));
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;

INSERT INTO analytics_event_part
  (id, workspace_id, user_id, event_type, entity_type, entity_id, payload, created_at)
OVERRIDING SYSTEM VALUE
SELECT id, workspace_id, user_id, event_type, entity_type, entity_id, payload, created_at
  FROM analytics_event;

ALTER TABLE analytics_event RENAME TO analytics_event_old036;
ALTER TABLE analytics_event_part RENAME TO analytics_event;
DROP TABLE analytics_event_old036; 

ALTER TABLE analytics_event ADD CONSTRAINT analytics_event_pkey PRIMARY KEY (id, created_at);
CREATE INDEX idx_analytics_type_time ON analytics_event (event_type, created_at DESC);
CREATE INDEX idx_analytics_ws ON analytics_event (workspace_id, created_at DESC);

DO $$
DECLARE seq text;
BEGIN
  seq := pg_get_serial_sequence('analytics_event', 'id');
  IF seq IS NOT NULL THEN
    -- is_called=false：下一个 nextval 恰好返回 max(id)+1；空表回落 1。
    PERFORM setval(seq, COALESCE((SELECT MAX(id) FROM analytics_event), 0) + 1, false);
  END IF;
END $$;
