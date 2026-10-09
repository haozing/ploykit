

CREATE TABLE schedule_plan (
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  kind          text NOT NULL,                        
  cron_expr     text NOT NULL,                        
  timezone      text NOT NULL DEFAULT 'UTC',          
  next_fire_at  timestamptz NOT NULL,                 
  misfire       text NOT NULL DEFAULT 'skip' CHECK (misfire IN ('skip', 'once')),
  last_fired_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  enabled       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX schedule_plan_due_idx ON schedule_plan (next_fire_at) WHERE enabled;
