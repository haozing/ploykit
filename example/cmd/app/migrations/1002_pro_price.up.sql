

UPDATE plan SET limits = limits || '{"price_monthly_cents":9900,"price_yearly_cents":99900}'::jsonb
WHERE code = 'pro';
