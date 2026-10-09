
INSERT INTO plan (code, name, limits, sort_no) VALUES
  ('free', '免费版', '{"workspaces":1,"tasks_monthly":50}'::jsonb, 1),
  ('pro',   '专业版', '{"workspaces":-1,"tasks_monthly":-1}'::jsonb, 2)
ON CONFLICT (code) DO NOTHING;
