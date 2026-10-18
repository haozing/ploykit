-- ADR 0016: personal-workspace provisioning. `kind` distinguishes the
-- per-user personal workspace ('personal') from explicit team workspaces;
-- every pre-existing and future row defaults to 'team'. The partial unique
-- index makes "one personal workspace per user" a DATABASE invariant —
-- provisioning idempotency (replays, lost races, JIT half-provisioning
-- convergence) rests on 23505, not on code discipline.
ALTER TABLE workspace
    ADD COLUMN kind text NOT NULL DEFAULT 'team' CHECK (kind IN ('team', 'personal'));

CREATE UNIQUE INDEX uq_workspace_personal
    ON workspace (created_by) WHERE kind = 'personal';
