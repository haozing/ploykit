

ALTER TABLE plan ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CNY';

ALTER TABLE plan DROP CONSTRAINT IF EXISTS plan_currency_format;
ALTER TABLE plan ADD CONSTRAINT plan_currency_format CHECK (currency ~ '^[A-Z]{3}$');
