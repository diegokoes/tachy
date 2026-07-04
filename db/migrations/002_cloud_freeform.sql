-- 002: drop the fixed environment vocabulary on knowledge_entries.cloud.
-- The old CHECK hardcoded ('prod','qa','private-cloud','on-prem'), but the
-- environment vocabulary is deployment-specific (dev/demo/preprod, branches…).
-- The app layer now enforces a lowercase-slug shape instead, and existing
-- values are surfaced for reuse (listEnvironments / GET /api/knowledge/environments).
-- Idempotent; mirrored in db/schema.sql (canonical for fresh installs).
-- NO explicit begin/commit here: the appliers (`tachy migrate`, test setup) wrap
-- each file in a transaction; psql users should use --single-transaction.

alter table knowledge_entries drop constraint if exists knowledge_entries_cloud_check;
