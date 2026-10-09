

UPDATE workspace SET plan_code = 'free', updated_at = now()
WHERE plan_code NOT IN (SELECT code FROM plan);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'workspace_plan_code_fkey'
    ) THEN
        ALTER TABLE workspace
            ADD CONSTRAINT workspace_plan_code_fkey
            FOREIGN KEY (plan_code) REFERENCES plan(code);
    END IF;
END
$$;
