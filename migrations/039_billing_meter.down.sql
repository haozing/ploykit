
DROP TRIGGER IF EXISTS trg_billing_meter_immutable ON billing_meter;
DROP FUNCTION IF EXISTS billing_meter_guard_immutable();
DROP TABLE IF EXISTS billing_meter;
