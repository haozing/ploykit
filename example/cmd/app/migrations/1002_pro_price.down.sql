
UPDATE plan SET limits = limits - 'price_monthly_cents' - 'price_yearly_cents'
WHERE code = 'pro';
