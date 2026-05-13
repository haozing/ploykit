-- Migration: Generic Plugin RAG Chunks
-- Date: 2026-05-11
--
-- Adds a plugin/user/workspace scoped chunk index. This is intentionally
-- generic: plugins decide business meaning, while the host owns isolation,
-- source tracking, and searchable chunks. Embeddings can be added later
-- without changing the plugin-facing API.

CREATE TABLE IF NOT EXISTS "plugin_rag_chunks" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text,
  "workspace_id" text NOT NULL,
  "source_id" text NOT NULL,
  "source_path" text,
  "source_hash" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_rag_chunks_active_chunk_idx"
  ON "plugin_rag_chunks" ("plugin_id", "user_id", "workspace_id", "source_id", "chunk_index")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_workspace_idx"
  ON "plugin_rag_chunks" ("plugin_id", "user_id", "workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_source_idx"
  ON "plugin_rag_chunks" ("plugin_id", "user_id", "workspace_id", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_path_idx"
  ON "plugin_rag_chunks" ("source_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_source_hash_idx"
  ON "plugin_rag_chunks" ("source_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_content_hash_idx"
  ON "plugin_rag_chunks" ("content_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_metadata_gin_idx"
  ON "plugin_rag_chunks" USING gin ("metadata");
--> statement-breakpoint
ALTER TABLE "plugin_rag_chunks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_rag_chunks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_rag_chunks_user_plugin_isolation ON "plugin_rag_chunks";
--> statement-breakpoint
CREATE POLICY plugin_rag_chunks_user_plugin_isolation ON "plugin_rag_chunks"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND user_id = current_app_user_id()
  )
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND user_id = current_app_user_id()
  )
);
