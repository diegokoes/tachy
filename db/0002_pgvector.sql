-- Migration 0002: enable semantic search on an existing tachy database.
-- Fresh installs already get this via schema.sql; run this only to upgrade a DB
-- created before pgvector support. Requires the pgvector extension to be
-- installable (the pgvector/pgvector image, or `apt install postgresql-16-pgvector`).
-- Safe to re-run.

create extension if not exists vector;

alter table knowledge_entries
    add column if not exists embedding vector(384);

create index if not exists knowledge_embedding_idx
    on knowledge_entries using hnsw (embedding vector_cosine_ops);

-- Existing rows have embedding = null. Populate them with:
--   npm run sync embed-backfill
