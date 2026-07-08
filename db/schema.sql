create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- immutable wrapper around array_to_string (STABLE) so generated columns can call it
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
    aliases     text[] not null default '{}',
    created_at  timestamptz not null default now(),
    unique (team_id, slug)
);

create index products_team_idx    on products(team_id);
create index products_aliases_idx on products using gin (aliases);

create table users (
    id            uuid primary key default gen_random_uuid(),
    email         text not null unique,
    display_name  text,
    -- Global role: admins manage users, org structure and settings.
    role          text not null default 'member' check (role in ('admin','member')),
    -- Scrypt hash for password login; null = SSO-only or attribution-only user.
    password_hash text,
    disabled      boolean not null default false,
    created_at    timestamptz not null default now()
);

-- Non-secret runtime settings (redaction, agent cost policy, org name),
-- managed by the setup wizard / Admin > System. Secrets stay in the
-- environment, never here.
create table settings (
    key         text primary key,
    value       jsonb not null,
    updated_at  timestamptz not null default now()
);

create table team_members (
    team_id   uuid not null references teams(id) on delete cascade,
    user_id   uuid not null references users(id) on delete cascade,
    -- 'admin' = team mini-admin: curates this team's knowledge/docs/taxonomy
    -- and membership without org-wide admin rights.
    role      text not null default 'member' check (role in ('admin','member')),
    primary key (team_id, user_id)
);

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
    customer_id           uuid references customers(id) on delete set null,
    observed_version      text,
    requester             text,
    raw                   jsonb,
    source_created_at     timestamptz,
    source_updated_at     timestamptz,
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

create table resolution_patterns (
    slug         text primary key,
    description  text not null,
    created_at   timestamptz not null default now()
);

-- Defined before knowledge_entries so entries can FK-reference their component.
create table components (
    id          uuid primary key default gen_random_uuid(),
    product_id  uuid not null references products(id) on delete cascade,
    parent_id   uuid references components(id) on delete cascade,
    slug        text not null,
    name        text not null,
    description text,
    aliases     text[] not null default '{}',
    created_at  timestamptz not null default now(),
    unique (product_id, slug)
);

create index components_product_idx on components(product_id);
create index components_parent_idx  on components(parent_id);
create index components_aliases_idx on components using gin (aliases);

create table knowledge_entries (
    id                  uuid primary key default gen_random_uuid(),
    work_item_id        uuid references work_items(id) on delete set null,
    product_id          uuid references products(id) on delete set null,
    team_id             uuid references teams(id) on delete set null,
    created_by          uuid references users(id) on delete set null,
    status              text not null default 'draft'
                            check (status in ('draft','approved','rejected','archived','deprecated')),
    -- 'deprecated' = outdated but still surfaced in search (flagged, optionally
    -- superseded); 'archived' = fully hidden from search.
    superseded_by       uuid references knowledge_entries(id) on delete set null,
    constraint knowledge_entries_no_self_supersede check (superseded_by is null or superseded_by <> id),

    issue_summary       text,
    symptoms            text[] not null default '{}',
    root_cause          text,
    resolution          text,
    resolution_pattern  text references resolution_patterns(slug),
    signals             text[] not null default '{}',
    tags                text[] not null default '{}',
    -- component is the validated taxonomy anchor; product_area is DERIVED from the
    -- component hierarchy at write time (kept as a column so the generated search
    -- columns below can reference it — they can't join other tables).
    component_id        uuid references components(id) on delete set null,
    product_area        text,
    confidence          text check (confidence is null or confidence in ('low','medium','high')),

    -- low-cardinality, filterable facets promoted out of `structured` so they're
    -- indexable/queryable (e.g. "all prod issues", "high learning-value entries").
    -- cloud = observed environment. Deliberately no CHECK: the vocabulary is
    -- deployment-specific (prod/qa vs dev/demo/preprod…). The app layer enforces
    -- a lowercase-slug shape and surfaces existing values for reuse.
    cloud               text,
    resolution_clarity  text check (resolution_clarity is null or resolution_clarity in ('clear','partial','unclear')),
    learning_value      text check (learning_value is null or learning_value in ('high','medium','low')),
    hidden_fix          boolean,
    -- Optional, free-form (like cloud). affected_version seeds from the work
    -- item's observed_version at save time; fixed_version is set on resolution.
    affected_version    text,
    fixed_version       text,
    structured          jsonb not null default '{}'::jsonb,

    embedding           vector(384),

    search_text text generated always as (
        coalesce(issue_summary,'') || ' ' ||
        coalesce(root_cause,'')   || ' ' ||
        coalesce(resolution,'')   || ' ' ||
        coalesce(resolution_pattern,'') || ' ' ||
        coalesce(product_area,'') || ' ' ||
        tachy_join(symptoms) || ' ' ||
        tachy_join(signals)  || ' ' ||
        tachy_join(tags)
    ) stored,

    search_tsv tsvector generated always as (
        to_tsvector('simple',
            coalesce(issue_summary,'') || ' ' ||
            coalesce(root_cause,'')   || ' ' ||
            coalesce(resolution,'')   || ' ' ||
            coalesce(resolution_pattern,'') || ' ' ||
            coalesce(product_area,'') || ' ' ||
            tachy_join(symptoms) || ' ' ||
            tachy_join(signals)  || ' ' ||
            tachy_join(tags)
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
create index knowledge_cloud_idx       on knowledge_entries(cloud);
create index knowledge_component_idx   on knowledge_entries(component_id);
create index knowledge_symptoms_idx    on knowledge_entries using gin (symptoms);
create index knowledge_signals_idx     on knowledge_entries using gin (signals);
create index knowledge_tags_idx        on knowledge_entries using gin (tags);
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
    kind                 text not null default 'note'
                             check (kind in ('correction','rating','note','deprecation')),
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
    mode            text not null check (mode in ('ingest','consult','sync')),
    model           text,
    input_tokens    integer,
    output_tokens   integer,
    meta            jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index analysis_runs_item_idx on analysis_runs(work_item_id);

create table labels (
    id          uuid primary key default gen_random_uuid(),
    product_id  uuid not null references products(id) on delete cascade,
    slug        text not null,
    description text,
    created_at  timestamptz not null default now(),
    unique (product_id, slug)
);

create index labels_product_idx on labels(product_id);

create table reference_docs (
    id          uuid primary key default gen_random_uuid(),
    product_id  uuid references products(id) on delete set null,
    team_id     uuid references teams(id) on delete set null,
    created_by  uuid references users(id) on delete set null,
    source      text,
    title       text not null,
    body        text not null,
    tags        text[] not null default '{}',
    structured  jsonb not null default '{}'::jsonb,
    status      text not null default 'approved'
                    check (status in ('draft','approved','archived')),

    search_text text generated always as (
        coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || tachy_join(tags)
    ) stored,
    search_tsv tsvector generated always as (
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || tachy_join(tags))
    ) stored,

    version     integer not null default 1,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index reference_docs_product_idx on reference_docs(product_id);
create index reference_docs_team_idx    on reference_docs(team_id);
create index reference_docs_status_idx  on reference_docs(status);
create index reference_docs_tags_idx    on reference_docs using gin (tags);
create index reference_docs_tsv_idx     on reference_docs using gin (search_tsv);
create index reference_docs_trgm_idx    on reference_docs using gin (search_text gin_trgm_ops);

create trigger reference_docs_updated_at
    before update on reference_docs
    for each row execute function set_updated_at();

create table reference_doc_chunks (
    id          uuid primary key default gen_random_uuid(),
    doc_id      uuid not null references reference_docs(id) on delete cascade,
    ordinal     integer not null,
    chunk_text  text not null,
    embedding   vector(384),
    unique (doc_id, ordinal)
);

create index reference_doc_chunks_doc_idx       on reference_doc_chunks(doc_id);
create index reference_doc_chunks_embedding_idx on reference_doc_chunks using hnsw (embedding vector_cosine_ops);
