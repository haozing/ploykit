

CREATE TABLE quota_consume_idem (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  counter_key  text NOT NULL,
  idem_key     text NOT NULL,
  
  period       text NOT NULL,
  amount       bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, counter_key, idem_key)
);
