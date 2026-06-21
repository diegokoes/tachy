create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- array_to_string is STABLE; this immutable wrapper lets generated columns call it.
create or replace function tachy_join(arr text[]) returns text
    language sql immutable parallel safe
    as $$ select array_to_string(arr, ' ') $$;

create table teams (
    id          uuid primary key default gen_random_uuid(),
    slug        text not null unique,
    name        text not null,
    created_at  timestamptz not null default now()
);

create table products (
    id          uuid primary key default gen_random_uuid(),
    team_id     uuid not null references teams(id) on delete cascade,
    slug        text not null,
    name        text not null,
    created_at  timestamptz not null default now(),
    unique (team_id, slug)
);

create index products_team_idx on products(team_id);

create table users (
    id            uuid primary key default gen_random_uuid(),
    email         text not null unique,
    display_name  text,
    created_at    timestamptz not null default now()
);

create table team_members (
    team_id   uuid not null references teams(id) on delete cascade,
    user_id   uuid not null references users(id) on delete cascade,
    role      text not null default 'member',
    primary key (team_id, user_id)
);

-- Maps a source-native grouping (Freshdesk group_id, GitHub owner/repo) to an internal product.
create table source_connections (
    id            uuid primary key default gen_random_uuid(),
    source_type   text not null,
    slug          text not null unique,
    base_url      text,
    config        jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create table source_product_map (
    id                    uuid primary key default gen_random_uuid(),
    source_connection_id  uuid not null references source_connections(id) on delete cascade,
    external_group_key    text not null,
    product_id            uuid not null references products(id) on delete cascade,
    unique (source_connection_id, external_group_key)
);

create table customers (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    slug        text not null unique,
    aliases     text[] not null default '{}',
    notes       text,
    created_at  timestamptz not null default now()
);

create index customers_aliases_idx on customers using gin (aliases);

create table work_items (
    id                    uuid primary key default gen_random_uuid(),
    source_connection_id  uuid not null references source_connections(id) on delete cascade,
    external_id           text not null,
    external_url          text,
    kind                  text,
    title                 text,
    status                text,
    external_group_key    text,
    product_id            uuid references products(id) on delete set null,
    team_id               uuid references teams(id) on delete set null,
    customer_id           uuid references customers(id) on delete set null,  -- resolved at ingest, correctable
    observed_version      text,
    requester             text,
    raw                   jsonb,
    source_created_at     timestamptz,
    source_updated_at     timestamptz,  -- drives incremental sync
    ingested_at           timestamptz not null default now(),
    unique (source_connection_id, external_id)
);

create index work_items_product_idx     on work_items(product_id);
create index work_items_team_idx        on work_items(team_id);
create index work_items_customer_idx    on work_items(customer_id);
create index work_items_updated_idx     on work_items(source_connection_id, source_updated_at);
create index work_items_group_key_idx   on work_items(source_connection_id, external_group_key);

create table work_item_messages (
    id              uuid primary key default gen_random_uuid(),
    work_item_id    uuid not null references work_items(id) on delete cascade,
    external_id     text,
    author          text,
    visibility      text,
    direction       text,
    body_text       text,
    attachments     jsonb not null default '[]'::jsonb,
    created_at      timestamptz,
    unique (work_item_id, external_id)
);

create index work_item_messages_item_idx on work_item_messages(work_item_id, created_at);

-- Controlled vocabulary for knowledge_entries.resolution_pattern. Starts empty;
-- add slugs deliberately as real, distinct patterns emerge.
create table resolution_patterns (
    slug         text primary key,
    description  text not null,
    created_at   timestamptz not null default now()
);

-- The learned, structured artifact that consult mode searches.
-- Customer-blind by design: identity lives on work_items, never here.
-- Nothing counts as knowledge until status = 'approved'.
create table knowledge_entries (
    id                  uuid primary key default gen_random_uuid(),
    work_item_id        uuid references work_items(id) on delete set null,
    product_id          uuid references products(id) on delete set null,
    team_id             uuid references teams(id) on delete set null,
    created_by          uuid references users(id) on delete set null,
    status              text not null default 'draft'
                            check (status in ('draft','approved','rejected','archived')),

    issue_summary       text,
    symptoms            text[] not null default '{}',
    root_cause          text,
    resolution          text,
    resolution_pattern  text references resolution_patterns(slug),
    signals             text[] not null default '{}',
    product_area        text,
    confidence          text check (confidence is null or confidence in ('low','medium','high')),
    structured          jsonb not null default '{}'::jsonb,

    embedding           vector(384),  -- null until backfilled

    search_text text generated always as (
        coalesce(issue_summary,'') || ' ' ||
        coalesce(root_cause,'')   || ' ' ||
        coalesce(resolution,'')   || ' ' ||
        coalesce(resolution_pattern,'') || ' ' ||
        coalesce(product_area,'') || ' ' ||
        tachy_join(symptoms) || ' ' ||
        tachy_join(signals)
    ) stored,

    search_tsv tsvector generated always as (
        to_tsvector('simple',
            coalesce(issue_summary,'') || ' ' ||
            coalesce(root_cause,'')   || ' ' ||
            coalesce(resolution,'')   || ' ' ||
            coalesce(resolution_pattern,'') || ' ' ||
            coalesce(product_area,'') || ' ' ||
            tachy_join(symptoms) || ' ' ||
            tachy_join(signals)
        )
    ) stored,

    version             integer not null default 1,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index knowledge_status_idx      on knowledge_entries(status);
create index knowledge_product_idx     on knowledge_entries(product_id);
create index knowledge_team_idx        on knowledge_entries(team_id);
create index knowledge_pattern_idx     on knowledge_entries(resolution_pattern);
create index knowledge_symptoms_idx    on knowledge_entries using gin (symptoms);
create index knowledge_signals_idx     on knowledge_entries using gin (signals);
create index knowledge_tsv_idx         on knowledge_entries using gin (search_tsv);
create index knowledge_trgm_idx        on knowledge_entries using gin (search_text gin_trgm_ops);
create index knowledge_embedding_idx   on knowledge_entries using hnsw (embedding vector_cosine_ops);

create or replace function set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger knowledge_entries_updated_at
    before update on knowledge_entries
    for each row execute function set_updated_at();

create table knowledge_feedback (
    id                   uuid primary key default gen_random_uuid(),
    knowledge_entry_id   uuid not null references knowledge_entries(id) on delete cascade,
    user_id              uuid references users(id) on delete set null,
    kind                 text not null default 'note',  -- 'correction' | 'rating' | 'note'
    rating               integer,
    comment              text,
    patch                jsonb,
    created_at           timestamptz not null default now()
);

create index knowledge_feedback_entry_idx on knowledge_feedback(knowledge_entry_id);

create table analysis_runs (
    id              uuid primary key default gen_random_uuid(),
    work_item_id    uuid references work_items(id) on delete set null,
    user_id         uuid references users(id) on delete set null,
    mode            text not null,  -- 'ingest' | 'consult' | 'sync'
    model           text,
    input_tokens    integer,
    output_tokens   integer,
    meta            jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index analysis_runs_item_idx on analysis_runs(work_item_id);

-- Hierarchical architecture glossary per product (services, modules, config pools).
-- Separate from knowledge_entries because architecture facts don't fit the
-- issue -> root_cause -> resolution shape.
create table components (
    id          uuid primary key default gen_random_uuid(),
    product_id  uuid not null references products(id) on delete cascade,
    parent_id   uuid references components(id) on delete cascade,
    slug        text not null,
    name        text not null,
    description text,
    created_at  timestamptz not null default now(),
    unique (product_id, slug)
);

create index components_product_idx on components(product_id);
create index components_parent_idx  on components(parent_id);
