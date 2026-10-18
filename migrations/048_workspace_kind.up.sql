-- ADR 0016: personal-workspace provisioning. `kind` distinguishes the
-- per-user personal workspace ('personal') from explicit team workspaces;
-- every pre-existing and future row defaults to 'team'. The partial unique
-- index makes "one personal workspace per user" a DATABASE invariant —
-- provisioning idempotency (replays, lost races, JIT half-provisioning
-- convergence) rests on 23505, not on code discipline.
--
-- ADOPTION WITH EXISTING USERS: this migration marks every pre-existing
-- workspace 'team'. A product adopting the provisioning factory AFTER it
-- already hand-provisioned personal workspaces must classify those legacy
-- rows via a product migration (1001+) —
--   UPDATE workspace SET kind = 'personal' WHERE <product predicate>;
-- otherwise ensure() sees no personal workspace for existing users and
-- provisions a second (empty) one on their next login. There is no
-- framework-side predicate: which legacy workspaces are "personal" is a
-- product decision.
ALTER TABLE workspace
    ADD COLUMN kind text NOT NULL DEFAULT 'team' CHECK (kind IN ('team', 'personal'));

CREATE UNIQUE INDEX uq_workspace_personal
    ON workspace (created_by) WHERE kind = 'personal';
