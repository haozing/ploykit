-- LC-3 click-through acceptance evidence (legal-compliance framework plan
-- 2026-10-25): the sign-in form already promises "signing in means agreeing"
-- -- this table is the backend proof of WHICH version a user accepted, WHEN,
-- from WHERE and through WHICH client. Versions ship with product code
-- (legal.RegisterDocs); no legal_documents table exists on purpose (audit
-- L4: a DB copy of the version would be a second truth).
--
-- Natural key (user_id, doc_key, doc_version): one evidence row per user per
-- version, first write wins -- INSERT .. ON CONFLICT DO NOTHING everywhere,
-- which is what makes the AfterRegister/AfterLogin hooks idempotent by
-- database invariant instead of code discipline.
-- Client environment is the structured platform triple, never a raw
-- User-Agent string; ON DELETE CASCADE follows the account purge lifecycle
-- (retention risk #2: acceptance rows leave together with the user).
CREATE TABLE legal_acceptances (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    doc_key          text NOT NULL,
    doc_version      text NOT NULL,
    method           text NOT NULL CHECK (method IN ('signup', 'login_implicit', 'reaccept')),
    ip               text NOT NULL DEFAULT '',
    client_platform  text NOT NULL DEFAULT '',
    client_version   text NOT NULL DEFAULT '',
    client_os        text NOT NULL DEFAULT '',
    accepted_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, doc_key, doc_version)
);

-- Admin evidence export ("which version did this user agree to" disputes):
-- newest first over a user's history.
CREATE INDEX idx_legal_acceptances_user_time ON legal_acceptances (user_id, accepted_at DESC);
