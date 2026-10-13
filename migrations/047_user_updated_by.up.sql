-- aifengkong #1 (Y-P1-4): modification attribution. Nullable on purpose —
-- system paths (JIT provisioning, seeded rows) have no human actor. Set by
-- write paths that know the actor (profile updates stamp the user themself;
-- future admin-side edits stamp the admin).
ALTER TABLE "user"
    ADD COLUMN updated_by uuid REFERENCES "user"(id) ON DELETE SET NULL;
