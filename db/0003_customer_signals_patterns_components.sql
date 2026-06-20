-- Migration 0003: customer/version context on work_items, a controlled
-- vocabulary for resolution_pattern, promoted retrieval signals, and an
-- architecture glossary (components). Fresh installs get all of this via
-- schema.sql; run this only to upgrade an existing tachy database.
-- Safe to re-run.

create table if not exists resolution_patterns (
    slug         text primary key,
    description  text not null,
    created_at   timestamptz not null default now()
);

create table if not exists customers (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    slug        text not null unique,
    aliases     text[] not null default '{}',
    notes       text,
    created_at  timestamptz not null default now()
);

create index if not exists customers_aliases_idx on customers using gin (aliases);

alter table work_items
    add column if not exists customer_id      uuid references customers(id) on delete set null,
    add column if not exists observed_version text;

create index if not exists work_items_customer_idx on work_items(customer_id);

-- resolution_patterns starts empty, so any existing free-text resolution_pattern
-- values can't satisfy the FK added below -- null them out rather than fail
-- the migration. The original phrase usually still lives in `structured`;
-- re-tag with a real slug (via add_resolution_pattern) once you've decided on one.
update knowledge_entries set resolution_pattern = null
where resolution_pattern is not null
  and resolution_pattern not in (select slug from resolution_patterns);

alter table knowledge_entries add column if not exists signals text[] not null default '{}';

-- Normalize existing confidence values to lowercase so the CHECK constraint
-- added below doesn't reject rows written before this migration.
update knowledge_entries set confidence = lower(confidence) where confidence is not null;

do $$ begin
    alter table knowledge_entries
        add constraint knowledge_entries_resolution_pattern_fkey
        foreign key (resolution_pattern) references resolution_patterns(slug);
exception when duplicate_object then null;
end $$;

do $$ begin
    alter table knowledge_entries
        add constraint knowledge_entries_status_check
        check (status in ('draft','approved','rejected','archived'));
exception when duplicate_object then null;
end $$;

do $$ begin
    alter table knowledge_entries
        add constraint knowledge_entries_confidence_check
        check (confidence is null or confidence in ('low','medium','high'));
exception when duplicate_object then null;
end $$;

-- Regenerate search_text / search_tsv to fold in signals. Generated columns
-- can't be altered in place; drop (which also drops their indexes) and recreate.
alter table knowledge_entries drop column if exists search_text;
alter table knowledge_entries drop column if exists search_tsv;

alter table knowledge_entries add column search_text text generated always as (
    coalesce(issue_summary,'') || ' ' ||
    coalesce(root_cause,'')   || ' ' ||
    coalesce(resolution,'')   || ' ' ||
    coalesce(resolution_pattern,'') || ' ' ||
    coalesce(product_area,'') || ' ' ||
    tachy_join(symptoms) || ' ' ||
    tachy_join(signals)
) stored;

alter table knowledge_entries add column search_tsv tsvector generated always as (
    to_tsvector('simple',
        coalesce(issue_summary,'') || ' ' ||
        coalesce(root_cause,'')   || ' ' ||
        coalesce(resolution,'')   || ' ' ||
        coalesce(resolution_pattern,'') || ' ' ||
        coalesce(product_area,'') || ' ' ||
        tachy_join(symptoms) || ' ' ||
        tachy_join(signals)
    )
) stored;

create index if not exists knowledge_signals_idx on knowledge_entries using gin (signals);
create index if not exists knowledge_tsv_idx     on knowledge_entries using gin (search_tsv);
create index if not exists knowledge_trgm_idx    on knowledge_entries using gin (search_text gin_trgm_ops);

create table if not exists components (
    id          uuid primary key default gen_random_uuid(),
    product_id  uuid not null references products(id) on delete cascade,
    parent_id   uuid references components(id) on delete cascade,
    slug        text not null,
    name        text not null,
    description text,
    created_at  timestamptz not null default now(),
    unique (product_id, slug)
);

create index if not exists components_product_idx on components(product_id);
create index if not exists components_parent_idx  on components(parent_id);

-- Existing embeddings were computed without signals/resolution_patterns.description
-- in the input text. Recompute them with:
--   npm run sync embed-backfill
-- (it only fills null embeddings, so first: update knowledge_entries set embedding = null;)
