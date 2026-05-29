create table if not exists module_rag_sources (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  source_id text not null,
  status text not null default 'indexed',
  content_digest text,
  content_length integer not null default 0,
  chunk_count integer not null default 0,
  indexed_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_rag_sources_lookup_idx
  on module_rag_sources (product_id, workspace_id, module_id, source_id, status);

create index if not exists module_rag_sources_digest_idx
  on module_rag_sources (product_id, module_id, content_digest);

create table if not exists module_rag_chunks (
  id text primary key,
  product_id text not null,
  workspace_id text,
  module_id text not null,
  source_id text not null,
  chunk_index integer not null,
  content text not null,
  embedding jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists module_rag_chunks_lookup_idx
  on module_rag_chunks (product_id, workspace_id, module_id, source_id, chunk_index);

create index if not exists module_rag_chunks_module_idx
  on module_rag_chunks (product_id, workspace_id, module_id);
