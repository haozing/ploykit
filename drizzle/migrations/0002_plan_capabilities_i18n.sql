-- Plan capabilities + i18n normalization

-- Migrate legacy `features.outputResolution` to namespaced `features['runlynk.outputResolution']`
UPDATE "entitlement_plans"
SET "features" = jsonb_set(
  COALESCE("features", '{}'::jsonb) - 'outputResolution',
  '{runlynk.outputResolution}',
  COALESCE("features"->'outputResolution', 'null'::jsonb),
  true
)
WHERE ("features" ? 'outputResolution')
  AND NOT ("features" ? 'runlynk.outputResolution');--> statement-breakpoint

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

