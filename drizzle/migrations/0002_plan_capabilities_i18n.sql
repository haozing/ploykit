-- Plan i18n normalization

-- Normalize language key from zh-CN to zh (keep original key for safety)
UPDATE "entitlement_plans"
SET "lang_jsonb" = jsonb_set(
  COALESCE("lang_jsonb", '{}'::jsonb),
  '{zh}',
  COALESCE("lang_jsonb"->'zh-CN', 'null'::jsonb),
  true
)
WHERE ("lang_jsonb" ? 'zh-CN')
  AND NOT ("lang_jsonb" ? 'zh');--> statement-breakpoint

