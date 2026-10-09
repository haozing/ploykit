

CREATE TABLE IF NOT EXISTS blog_post (
  slug       text PRIMARY KEY,
  title      text NOT NULL,
  excerpt    text NOT NULL DEFAULT '',
  content    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
