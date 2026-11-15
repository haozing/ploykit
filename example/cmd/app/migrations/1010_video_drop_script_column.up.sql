-- Product migration 1010: eliminate the script/version double source of
-- truth (delivery audit A-item; v2.0 §11.2 D11).
--
-- video_project.script duplicated IR.script: SetScript updated ir.script
-- but never this column, so reads through the column returned stale text.
-- IR.script is the only truth; the column is dropped and the two SELECTs
-- that scanned it now derive the project script from the IR document.
ALTER TABLE video_project DROP COLUMN IF EXISTS script;

-- IR documents persisted before schemaVersion existed (and any document
-- that still embeds the row-level `version`) are stamped on read-in place
-- by app/ir.go normalizeSchema; no data migration is possible for the
-- embedded field itself, so readers simply ignore it and the next Mutate
-- persists a clean document (schemaVersion set, no version key).
