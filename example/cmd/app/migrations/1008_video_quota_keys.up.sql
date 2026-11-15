-- Product migration 1008: quota key declarations for video renders.
-- Fail-closed deployment order (hard constraint): plan rows without the key
-- reject renders at Consume time, so this migration MUST ship in the same
-- change set as (or before) the render feature is enabled.
UPDATE plan SET limits = limits || '{"video_renders_monthly": 5}'::jsonb WHERE code = 'free';
UPDATE plan SET limits = limits || '{"video_renders_monthly": -1}'::jsonb WHERE code = 'pro';
