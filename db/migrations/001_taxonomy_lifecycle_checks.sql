-- 001: component FK + deprecation lifecycle + missing CHECK constraints.
-- Idempotent: safe to re-run, and a no-op on databases created from the current
-- db/schema.sql (which is canonical for fresh installs — every migration here must
-- be mirrored there).
-- NO explicit begin/commit here: the appliers (`tachy migrate`, test setup) wrap
-- each file in a transaction; psql users should use --single-transaction.

-- Normalize dirty data BEFORE adding CHECKs, or the ALTERs abort.
update knowledge_feedback set kind = 'note'
    where kind not in ('correction','rating','note','deprecation');
update analysis_runs set mode = 'consult'
    where mode not in ('ingest','consult','sync');

-- knowledge_entries: allow 'deprecated' status.
alter table knowledge_entries drop constraint if exists knowledge_entries_status_check;
alter table knowledge_entries add constraint knowledge_entries_status_check
    check (status in ('draft','approved','rejected','archived','deprecated'));

-- knowledge_entries: component anchor + supersede link.
alter table knowledge_entries add column if not exists component_id
    uuid references components(id) on delete set null;
alter table knowledge_entries add column if not exists superseded_by
    uuid references knowledge_entries(id) on delete set null;
alter table knowledge_entries drop constraint if exists knowledge_entries_no_self_supersede;
alter table knowledge_entries add constraint knowledge_entries_no_self_supersede
    check (superseded_by is null or superseded_by <> id);
create index if not exists knowledge_component_idx on knowledge_entries(component_id);

-- Missing enum CHECKs (app layers already enforced these; the DB now agrees).
alter table knowledge_feedback drop constraint if exists knowledge_feedback_kind_check;
alter table knowledge_feedback add constraint knowledge_feedback_kind_check
    check (kind in ('correction','rating','note','deprecation'));
alter table analysis_runs drop constraint if exists analysis_runs_mode_check;
alter table analysis_runs add constraint analysis_runs_mode_check
    check (mode in ('ingest','consult','sync'));

-- No automatic component backfill: existing rows keep their free-text product_area
-- and a null component_id; map them via the curation workflow (update_knowledge_entry
-- with `component`). A best-effort starting point, if ever wanted (DO NOT run blindly —
-- verify matches by hand):
--   update knowledge_entries k set component_id = c.id
--   from components c
--   where k.component_id is null and k.product_id = c.product_id
--     and lower(split_part(k.product_area, ' / ', -1)) in
--         (select lower(x) from unnest(c.aliases || c.slug || c.name) as x);
