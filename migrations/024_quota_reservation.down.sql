
DROP TABLE IF EXISTS quota_reservation;
ALTER TABLE quota_counter DROP COLUMN IF EXISTS reserved;
