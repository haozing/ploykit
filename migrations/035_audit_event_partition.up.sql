

LOCK TABLE audit_event IN ACCESS EXCLUSIVE MODE;

CREATE TABLE audit_event_part (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id   uuid,
  actor_type     text NOT NULL CHECK (actor_type IN ('user', 'pat', 'system')),
  actor_id       text,
  actor_snapshot jsonb NOT NULL DEFAULT '{}',
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text,
  request_id     text,
  metadata       jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
  lo_m date;
  hi_m date;
  m date;
BEGIN
  SELECT COALESCE(date_trunc('month', MIN(created_at) AT TIME ZONE 'utc'),
                  date_trunc('month', now() AT TIME ZONE 'utc'))::date
    INTO lo_m FROM audit_event;
  -- 上界取 max(当前月+2, 存量最晚月)：防未来时间戳数据（时钟漂移）无分区可落。
  SELECT GREATEST(
           date_trunc('month', now() AT TIME ZONE 'utc') + interval '2 months',
           COALESCE(date_trunc('month', MAX(created_at) AT TIME ZONE 'utc'),
                    date_trunc('month', now() AT TIME ZONE 'utc')))::date
    INTO hi_m FROM audit_event;
  m := lo_m;
  WHILE m <= hi_m LOOP
    EXECUTE format(
      'CREATE TABLE audit_event_%s PARTITION OF audit_event_part FOR VALUES FROM (''%sT00:00:00+00'') TO (''%sT00:00:00+00'')',
      to_char(m, 'YYYY_MM'), to_char(m, 'YYYY-MM-DD'), to_char(m + interval '1 month', 'YYYY-MM-DD'));
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;

INSERT INTO audit_event_part
  (id, workspace_id, actor_type, actor_id, actor_snapshot, action, resource_type, resource_id, request_id, metadata, created_at)
SELECT id, workspace_id, actor_type, actor_id, actor_snapshot, action, resource_type, resource_id, request_id, metadata, created_at
  FROM audit_event;

ALTER TABLE audit_event RENAME TO audit_event_old035;
ALTER TABLE audit_event_part RENAME TO audit_event;
DROP TABLE audit_event_old035; 

ALTER TABLE audit_event ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id, created_at);
CREATE INDEX idx_audit_ws_time ON audit_event (workspace_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_event (action, created_at DESC);
CREATE INDEX idx_audit_created ON audit_event (created_at DESC);
CREATE INDEX idx_audit_actor_time ON audit_event (actor_id, created_at DESC);
