

CREATE TABLE IF NOT EXISTS billing_meter (
  slug         text PRIMARY KEY,                              
  display_name text NOT NULL,
  agg_type     text NOT NULL CHECK (agg_type IN ('sum', 'count', 'unique_count', 'latest')),
  unit         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION billing_meter_guard_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.slug <> OLD.slug OR NEW.agg_type <> OLD.agg_type THEN
    RAISE EXCEPTION 'billing_meter %: slug/agg_type immutable (changing them would redefine already-collected usage)', OLD.slug;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_meter_immutable ON billing_meter;
CREATE TRIGGER trg_billing_meter_immutable BEFORE UPDATE ON billing_meter
  FOR EACH ROW EXECUTE FUNCTION billing_meter_guard_immutable();
