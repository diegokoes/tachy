-- ============================================================================
-- tachy — knowledge engine for engineering work items
--
-- Design goals:
--   * SOURCE-AGNOSTIC: no "tickets" table. work_items are fed by pluggable
--     sources (freshdesk, github, ...). Adding a source = new rows in
--     source_connections + a new adapter in code. No schema change.
--   * MULTI-TEAM / MULTI-PRODUCT: teams -> products (ftrace, tpd under
--     Track&Trace; csdr, eudr, pcf, medical-devices under BPT). A source's
--     native grouping (Freshdesk group_id, GitHub repo) maps to a product.
--   * MULTI-USER: engineers are first-class; entries track author + approval.
--   * HUMAN-IN-THE-LOOP: knowledge_entries have a status gate (draft ->
--     approved) so nothing is "learned" until you give the OK.
--   * RETRIEVAL: FTS + trigram now; a pgvector column is reserved for later.
--
-- Secrets (API tokens) NEVER live in this DB. source_connections holds only
-- non-secret config; the actual token is resolved from env by the adapter,
-- keyed on source_connections.slug.
--
-- Target: PostgreSQL 14+.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid() (built-in on PG13+, harmless here)
create extension if not exists pg_trgm;    -- trigram fuzzy / error-code matching
create extension if not exists vector;     -- pgvector: 384-dim semantic search

-- array_to_string is only STABLE, which generated columns reject. This wrapper
-- is genuinely immutable for our fixed (text[], single space) usage, so the
-- search_text / search_tsv generated columns below can call it.
create or replace function tachy_join(arr text[]) returns text
    language sql immutable parallel safe
    as $$ select array_to_string(arr, ' ') $$;

-- ---------------------------------------------------------------------------
-- Org hierarchy
-- ---------------------------------------------------------------------------

create table teams (
    id          uuid primary key default gen_random_uuid(),
    slug        text not null unique,                 -- 'track-and-trace', 'bpt'
    name        text not null,
    created_at  timestamptz not null default now()
);

create table products (
    id          uuid primary key default gen_random_uuid(),
    team_id     uuid not null references teams(id) on delete cascade,
    slug        text not null,                        -- 'tpd', 'ftrace', 'eudr'
    name        text not null,
    created_at  timestamptz not null default now(),
    unique (team_id, slug)
);

create index products_team_idx on products(team_id);

-- ---------------------------------------------------------------------------
-- Users (engineers) + team membership
-- ---------------------------------------------------------------------------

create table users (
    id            uuid primary key default gen_random_uuid(),
    email         text not null unique,
    display_name  text,
    created_at    timestamptz not null default now()
);

create table team_members (
    team_id   uuid not null references teams(id) on delete cascade,
    user_id   uuid not null references users(id) on delete cascade,
    role      text not null default 'member',         -- 'member' | 'lead' | 'admin'
    primary key (team_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Sources: where work items come from.
-- A source_connection is one configured instance of a source_type
-- (e.g. the osapiens Freshdesk tenant, or a specific GitHub org/repo).
-- ---------------------------------------------------------------------------

create table source_connections (
    id            uuid primary key default gen_random_uuid(),
    source_type   text not null,                      -- 'freshdesk' | 'github' | ...
    slug          text not null unique,               -- 'osapiens-freshdesk' (token resolved from env by this slug)
    base_url      text,                               -- 'https://osapiens-desk.freshdesk.com'
    config        jsonb not null default '{}'::jsonb, -- non-secret config only
    created_at    timestamptz not null default now()
);

-- Resolve a source-native grouping to an internal product.
-- Freshdesk: external_group_key = group_id (as text).
-- GitHub:    external_group_key = 'owner/repo' or a label.
create table source_product_map (
    id                    uuid primary key default gen_random_uuid(),
    source_connection_id  uuid not null references source_connections(id) on delete cascade,
    external_group_key    text not null,
    product_id            uuid not null references products(id) on delete cascade,
    unique (source_connection_id, external_group_key)
);

-- ---------------------------------------------------------------------------
-- Customers: who a work item is for. Mainly relevant to ticket-based sources
-- (Freshdesk); left null for sources with no customer concept (GitHub).
-- Distributors/resellers often front for the same underlying account
-- (e.g. Arvato fronting for Davidoff) — aliases lets one row absorb all the
-- names/email domains that should resolve to the same customer.
-- ---------------------------------------------------------------------------

create table customers (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,                        -- canonical display name, e.g. 'Davidoff'
    slug        text not null unique,
    aliases     text[] not null default '{}',         -- other names / email domains resolving here
    notes       text,                                 -- freeform: factory variants, deployment quirks
    created_at  timestamptz not null default now()
);

create index customers_aliases_idx on customers using gin (aliases);

-- ---------------------------------------------------------------------------
-- Work items: the generic unit (a Freshdesk ticket OR a GitHub issue OR ...)
-- ---------------------------------------------------------------------------

create table work_items (
    id                    uuid primary key default gen_random_uuid(),
    source_connection_id  uuid not null references source_connections(id) on delete cascade,
    external_id           text not null,              -- '58925', or gh issue number
    external_url          text,
    kind                  text,                       -- 'ticket' | 'issue'
    title                 text,
    status                text,                       -- native status string (raw)
    external_group_key    text,                       -- raw group_id / repo, for mapping + audit
    product_id            uuid references products(id) on delete set null,  -- resolved at ingest
    team_id               uuid references teams(id) on delete set null,     -- denormalized for fast scoping
    customer_id           uuid references customers(id) on delete set null, -- resolved at ingest, correctable
    observed_version      text,                       -- version mentioned/known for THIS ticket, if any (raw, unvalidated)
    requester             text,
    raw                   jsonb,                      -- full original metadata payload (traceability)
    source_created_at     timestamptz,
    source_updated_at     timestamptz,                -- drives incremental sync
    ingested_at           timestamptz not null default now(),
    unique (source_connection_id, external_id)
);

create index work_items_product_idx     on work_items(product_id);
create index work_items_team_idx        on work_items(team_id);
create index work_items_customer_idx    on work_items(customer_id);
create index work_items_updated_idx     on work_items(source_connection_id, source_updated_at);
create index work_items_group_key_idx   on work_items(source_connection_id, external_group_key);

-- ---------------------------------------------------------------------------
-- Work item messages: conversation / comment history (public + private)
-- ---------------------------------------------------------------------------

create table work_item_messages (
    id              uuid primary key default gen_random_uuid(),
    work_item_id    uuid not null references work_items(id) on delete cascade,
    external_id     text,
    author          text,
    visibility      text,                             -- 'public' | 'private' | 'internal'
    direction       text,                             -- 'incoming' | 'outgoing'
    body_text       text,
    attachments     jsonb not null default '[]'::jsonb,
    created_at      timestamptz,                      -- source-side timestamp
    unique (work_item_id, external_id)
);

create index work_item_messages_item_idx on work_item_messages(work_item_id, created_at);

-- ---------------------------------------------------------------------------
-- Resolution patterns: controlled vocabulary for knowledge_entries.resolution_pattern.
-- Seeded empty on purpose — add rows deliberately (same motion as adding a
-- team/product) as real, distinct patterns emerge. Free phrasing here would
-- defeat the whole point of the index below: cross-team grouping needs an
-- exact, curated vocabulary, not prose that varies ticket to ticket.
-- ---------------------------------------------------------------------------

create table resolution_patterns (
    slug         text primary key,                    -- 'config-mismatch', 'version-incompatibility', ...
    description  text not null,
    created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Knowledge entries: the learned, structured, queryable artifact.
-- This is what "consult mode" searches. One per analyzed work item
-- (or manual). Nothing here counts as knowledge until status = 'approved'.
-- Customer-blind by design: identity/version context lives on work_items,
-- never here, so retrieval matches on the fault, not on who reported it.
-- ---------------------------------------------------------------------------

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
    resolution_pattern  text references resolution_patterns(slug),  -- nullable; curated vocabulary only
    signals             text[] not null default '{}',  -- error codes, config filenames, component names: the
                                                          -- most distinctive search terms, promoted out of `structured`
    product_area        text,
    confidence          text check (confidence is null or confidence in ('low','medium','high')),
    structured          jsonb not null default '{}'::jsonb,  -- full JSON blob; future fields land here, no migration

    embedding           vector(384),                    -- local all-MiniLM-L6-v2; null until embedded

    -- Denormalized text for trigram (fuzzy / error codes). Generated columns
    -- cannot reference each other, so the concat is repeated in search_tsv.
    -- Can only see this row's own columns (no joins), so resolution_pattern
    -- contributes its slug here, not resolution_patterns.description — the
    -- richer description is only used in the application-level embedding text.
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

-- ---------------------------------------------------------------------------
-- Feedback: human corrections / ratings on a knowledge entry.
-- Schema only — not yet wired up to any MCP tool, REST endpoint, or CLI.
-- ---------------------------------------------------------------------------

create table knowledge_feedback (
    id                   uuid primary key default gen_random_uuid(),
    knowledge_entry_id   uuid not null references knowledge_entries(id) on delete cascade,
    user_id              uuid references users(id) on delete set null,
    kind                 text not null default 'note',   -- 'correction' | 'rating' | 'note'
    rating               integer,                        -- optional 1..5
    comment              text,
    patch                jsonb,                          -- proposed field changes
    created_at           timestamptz not null default now()
);

create index knowledge_feedback_entry_idx on knowledge_feedback(knowledge_entry_id);

-- ---------------------------------------------------------------------------
-- Analysis runs: optional audit + token accounting (controlled cost).
-- Schema only — nothing currently inserts into this table.
-- ---------------------------------------------------------------------------

create table analysis_runs (
    id              uuid primary key default gen_random_uuid(),
    work_item_id    uuid references work_items(id) on delete set null,
    user_id         uuid references users(id) on delete set null,
    mode            text not null,                  -- 'ingest' | 'consult' | 'sync'
    model           text,
    input_tokens    integer,
    output_tokens   integer,
    meta            jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index analysis_runs_item_idx on analysis_runs(work_item_id);

-- ---------------------------------------------------------------------------
-- Components: an architecture glossary, not tied to any work_item or ticket.
-- Static facts about what a product is made of (services, modules, config
-- pools), fed conversationally — either directly described by a human, or
-- proposed by Claude when a ticket mentions something unfamiliar and then
-- confirmed by a human before being added (same human-gated motion as
-- resolution_patterns). knowledge_entries is shaped around issue -> root
-- cause -> resolution; this table exists because architecture facts don't
-- fit that shape and don't belong there. Hierarchical so e.g. business-object
-- can have pools (configuration, id-issuer, ...) nested under it.
-- ---------------------------------------------------------------------------

create table components (
    id          uuid primary key default gen_random_uuid(),
    product_id  uuid not null references products(id) on delete cascade,
    parent_id   uuid references components(id) on delete cascade,
    slug        text not null,                        -- 'line-controller', 'business-object-id-issuer'
    name        text not null,                         -- 'Line Controller', 'Business Object / ID Issuer'
    description text,
    created_at  timestamptz not null default now(),
    unique (product_id, slug)
);

create index components_product_idx on components(product_id);
create index components_parent_idx  on components(parent_id);

-- ============================================================================
-- SEED (edit/remove freely — this just reflects the org you described).
-- Idempotent via ON CONFLICT so re-running schema.sql is safe.
-- ============================================================================

insert into teams (slug, name) values
    ('track-and-trace', 'Track & Trace'),
    ('bpt',             'BPT')
on conflict (slug) do nothing;

insert into products (team_id, slug, name)
select t.id, p.slug, p.name
from (values
    ('track-and-trace', 'tpd',             'TPD'),
    ('track-and-trace', 'ftrace',          'FTrace'),
    ('bpt',             'csdr',            'CSDR'),
    ('bpt',             'eudr',            'EUDR'),
    ('bpt',             'pcf',             'PCF'),
    ('bpt',             'medical-devices', 'Medical Devices')
) as p(team_slug, slug, name)
join teams t on t.slug = p.team_slug
on conflict (team_id, slug) do nothing;

insert into source_connections (source_type, slug, base_url) values
    ('freshdesk', 'osapiens-freshdesk', 'https://osapiens-desk.freshdesk.com')
on conflict (slug) do nothing;

-- Example mapping: Freshdesk group_id 48000641379 -> TPD (from ticket 58925).
-- Verify the group_id->product mapping for your other groups and add rows.
insert into source_product_map (source_connection_id, external_group_key, product_id)
select sc.id, '48000641379', p.id
from source_connections sc
join products p on p.slug = 'tpd'
join teams t on t.id = p.team_id and t.slug = 'track-and-trace'
where sc.slug = 'osapiens-freshdesk'
on conflict (source_connection_id, external_group_key) do nothing;

-- Example GitHub source (token resolved from GITHUB_TOKEN_OSAPIENS_GH / GITHUB_TOKEN).
-- config.repos lists the repos to sync; each 'owner/repo' maps to a product below.
-- insert into source_connections (source_type, slug, base_url, config) values
--     ('github', 'osapiens-gh', 'https://api.github.com', '{"repos":["osapiens/ftrace"]}'::jsonb)
-- on conflict (slug) do nothing;
--
-- insert into source_product_map (source_connection_id, external_group_key, product_id)
-- select sc.id, 'osapiens/ftrace', p.id
-- from source_connections sc join products p on p.slug = 'ftrace'
-- where sc.slug = 'osapiens-gh'
-- on conflict (source_connection_id, external_group_key) do nothing;
