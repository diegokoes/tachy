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

-- Encrypted secrets (agent API keys, source tokens) at three scopes with
-- most-specific-wins resolution: user > team > global > env fallback.
-- Values are AES-256-GCM ciphertext keyed by TACHY_SECRET_KEY; plaintext
-- never leaves the server process.
create table credentials (
    id               uuid primary key default gen_random_uuid(),
    scope            text not null check (scope in ('global','team','user')),
    team_id          uuid references teams(id) on delete cascade,
    user_id          uuid references users(id) on delete cascade,
    -- e.g. 'anthropic_api_key', 'copilot_token', 'freshdesk_token:<slug>'
    name             text not null,
    value_ciphertext bytea not null,
    nonce            bytea not null,
    created_by       uuid references users(id),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    -- scope and its FK must agree, or a scope='team' row with a null team_id
    -- slips past the partial unique indexes and can be inserted repeatedly
    check ((scope = 'team') = (team_id is not null)),
    check ((scope = 'user') = (user_id is not null))
);
create unique index credentials_global_idx on credentials(name)          where scope = 'global';
create unique index credentials_team_idx   on credentials(team_id, name) where scope = 'team';
create unique index credentials_user_idx   on credentials(user_id, name) where scope = 'user';

-- Non-secret per-user/per-team preferences (agent provider/model/effort),
-- same scope layout as credentials; global defaults live in `settings`.
create table preferences (
    id          uuid primary key default gen_random_uuid(),
    scope       text not null check (scope in ('global','team','user')),
    team_id     uuid references teams(id) on delete cascade,
    user_id     uuid references users(id) on delete cascade,
    key         text not null,
    value       jsonb not null,
    updated_at  timestamptz not null default now(),
    check ((scope = 'team') = (team_id is not null)),
    check ((scope = 'user') = (user_id is not null))
);
create unique index preferences_global_idx on preferences(key)          where scope = 'global';
create unique index preferences_team_idx   on preferences(team_id, key) where scope = 'team';
create unique index preferences_user_idx   on preferences(user_id, key) where scope = 'user';

-- Reusable chat prompt templates ("artifacts"), same scope layout as
-- credentials/preferences; the picker unions user + team + global rows.
create table artifacts (
    id          uuid primary key default gen_random_uuid(),
    scope       text not null check (scope in ('global','team','user')),
    team_id     uuid references teams(id) on delete cascade,
    user_id     uuid references users(id) on delete cascade,
    slug        text not null,
    title       text not null,
    description text,
    body        text not null,
    spec        jsonb,
    created_by  uuid references users(id),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    check ((scope = 'team') = (team_id is not null)),
    check ((scope = 'user') = (user_id is not null))
);
create unique index artifacts_global_idx on artifacts(slug)          where scope = 'global';
create unique index artifacts_team_idx   on artifacts(team_id, slug) where scope = 'team';
create unique index artifacts_user_idx   on artifacts(user_id, slug) where scope = 'user';

-- Files produced for download (export_table, ...); short-lived by design.
create table generated_outputs (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references users(id) on delete cascade,
    artifact_id uuid references artifacts(id) on delete set null,
    utility     text not null,
    filename    text not null,
    mime        text not null,
    bytes       bytea not null,
    byte_size   integer not null,
    meta        jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null
);
create index generated_outputs_user_idx   on generated_outputs(user_id, created_at desc);
create index generated_outputs_expiry_idx on generated_outputs(expires_at);

create table source_connections (
    id            uuid primary key default gen_random_uuid(),
    source_type   text not null,
    slug          text not null unique,
    base_url      text,
    config        jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create table customers (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    slug        text not null unique,
    -- other NAMES the same account trades under. Never email domains: a domain
    -- here would come back out of list_customers as something to call them.
    aliases     text[] not null default '{}',
    -- domains whose senders are this customer, including partners who front for
    -- them (a distributor raising tickets on their behalf). A domain registered
    -- to two customers resolves to neither — see resolveCustomerByEmail.
    email_domains text[] not null default '{}',
    notes       text,
    created_at  timestamptz not null default now()
);

create index customers_aliases_idx on customers using gin (aliases);
create index customers_domains_idx on customers using gin (email_domains);

-- A project as its source system knows it: an Azure DevOps project, a Freshdesk
-- group, a GitHub owner/repo. role='knowledge' binds it to a product — its items
-- ingest there, and it may own a wiki, repos and area mappings. role='tracker' is
-- a productless target we only create or reassign work items in, so team_id is
-- its sole owner for authorization.
create table source_projects (
    id                    uuid primary key default gen_random_uuid(),
    source_connection_id  uuid not null references source_connections(id) on delete cascade,
    -- the source's own key: ADO project name, Freshdesk group id, 'owner/repo'
    external_key          text not null,
    name                  text not null,
    product_id            uuid references products(id) on delete cascade,
    team_id               uuid not null references teams(id) on delete cascade,
    -- Set when the whole project exists for one customer (their own ADO project).
    -- Then every item ingested from it is theirs by configuration rather than by
    -- guessing at the sender's domain, which partners and freemail defeat. Null
    -- means the project serves many, and each ticket is resolved on its own.
    customer_id           uuid references customers(id) on delete set null,
    role                  text not null check (role in ('knowledge','tracker')),
    -- [{identifier, name, type, root_path, default}] — an ADO project routinely
    -- has several wikis (one project wiki plus a code wiki per repo). Exactly one
    -- carries default:true; that is the one every tool uses with no wiki argument.
    wikis                 jsonb not null default '[]'::jsonb,
    -- {defaults: {<work item type>: {<ado field>: value}}}, applied underneath
    -- the fields create_ado_work_item is called with
    config                jsonb not null default '{}'::jsonb,
    notes                 text,
    created_at            timestamptz not null default now(),
    -- role and product must agree, or a 'knowledge' row with no product silently
    -- routes every ingested item nowhere
    check ((role = 'knowledge') = (product_id is not null)),
    unique (source_connection_id, external_key)
);

create index source_projects_product_idx  on source_projects(product_id);
create index source_projects_customer_idx on source_projects(customer_id);
create index source_projects_team_idx    on source_projects(team_id);


create table work_items (
    id                    uuid primary key default gen_random_uuid(),
    source_connection_id  uuid not null references source_connections(id) on delete cascade,
    external_id           text not null,
    external_url          text,
    kind                  text,
    title                 text,
    status                text,
    external_group_key    text,
    source_project_id     uuid references source_projects(id) on delete set null,
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
create index work_items_project_idx     on work_items(source_project_id);
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

-- "this Freshdesk ticket is tracked by ADO #50912": written when a fetched item
-- mentions work item ids and when one is created from a ticket. The target is
-- often not ingested, so it is recorded either as a work item row or as
-- (project, external id), and tightens to the former once that item is fetched.
create table work_item_links (
    id                   uuid primary key default gen_random_uuid(),
    from_work_item_id    uuid not null references work_items(id) on delete cascade,
    to_work_item_id      uuid references work_items(id) on delete cascade,
    to_source_project_id uuid references source_projects(id) on delete set null,
    to_external_id       text,
    kind                 text not null check (kind in ('tracked_by','duplicates','relates')),
    created_by           uuid references users(id) on delete set null,
    created_at           timestamptz not null default now(),
    check (to_work_item_id is not null or to_external_id is not null)
);

create index work_item_links_from_idx on work_item_links(from_work_item_id);
create index work_item_links_to_idx   on work_item_links(to_work_item_id);
-- Conflict targets for the idempotent writes: re-fetching a ticket must not pile
-- up another copy of the same link.
create unique index work_item_links_pair_idx
    on work_item_links(from_work_item_id, to_work_item_id, kind)
    where to_work_item_id is not null;
create unique index work_item_links_external_idx
    on work_item_links(from_work_item_id, to_source_project_id, to_external_id, kind)
    nulls not distinct
    where to_external_id is not null;

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

-- Which components each customer runs. Many-to-many: a shared component links to
-- many customers, one built for a single customer links to just that one, and
-- nothing has to declare which sort it is.
create table customer_components (
    customer_id  uuid not null references customers(id) on delete cascade,
    component_id uuid not null references components(id) on delete cascade,
    notes        text,
    created_at   timestamptz not null default now(),
    primary key (customer_id, component_id)
);

create index customer_components_component_idx on customer_components(component_id);

-- Everything about a customer's install that is not an entity in its own right:
-- the version they run, their line layout, an integration they depend on. Their
-- repos, projects and components are edges instead — those are real records.
--
-- `kind` is a deployment-specific vocabulary, exactly like knowledge_entries.cloud:
-- no lookup table, because what counts as a customer specific differs per
-- deployment. list_customer_fact_kinds reports what is already in use so callers
-- reuse a value instead of coining a near-duplicate.
create table customer_facts (
    id           uuid primary key default gen_random_uuid(),
    customer_id  uuid not null references customers(id) on delete cascade,
    kind         text not null,
    -- What the fact is about when the kind alone is ambiguous: which product a
    -- version belongs to, which line a layout describes. '' when it needs none,
    -- so (customer, kind, label) can be unique and a re-set replaces in place.
    label        text not null default '',
    value        text not null,
    notes        text,
    -- Where this was learned — a ticket URL, a wiki page, a person.
    source       text,
    component_id uuid references components(id) on delete set null,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (customer_id, kind, label)
);

create index customer_facts_customer_idx on customer_facts(customer_id);
create index customer_facts_kind_idx     on customer_facts(kind);

-- Azure DevOps System.AreaPath prefix -> component, so an ingested item lands on
-- the right component instead of being guessed at. A table rather than jsonb on
-- source_projects: a component rename rewrites an FK, it cannot rewrite a slug
-- buried in a blob. Longest matching prefix wins at read time.
create table project_area_map (
    id                 uuid primary key default gen_random_uuid(),
    source_project_id  uuid not null references source_projects(id) on delete cascade,
    area_prefix        text not null,
    component_id       uuid not null references components(id) on delete cascade,
    unique (source_project_id, area_prefix)
);

create index project_area_map_component_idx on project_area_map(component_id);

create table knowledge_entries (
    id                  uuid primary key default gen_random_uuid(),
    work_item_id        uuid references work_items(id) on delete set null,
    product_id          uuid references products(id) on delete set null,
    team_id             uuid references teams(id) on delete set null,
    -- whose install this was learned on. The second taxonomy axis: component says
    -- which part of the product, customer says whose. Null = general to everyone.
    -- Held here rather than read through work_item_id, which is set null on delete.
    customer_id         uuid references customers(id) on delete set null,
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
    -- on update cascade so renaming a pattern slug rewrites referencing entries.
    resolution_pattern  text references resolution_patterns(slug) on update cascade,
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

    embedding           vector(768),

    -- cloud and affected_version are in here so they are searchable as words:
    -- typing "prod printer error" narrows by environment without spending a
    -- filter control on it.
    search_text text generated always as (
        coalesce(issue_summary,'') || ' ' ||
        coalesce(root_cause,'')   || ' ' ||
        coalesce(resolution,'')   || ' ' ||
        coalesce(resolution_pattern,'') || ' ' ||
        coalesce(product_area,'') || ' ' ||
        coalesce(cloud,'')        || ' ' ||
        coalesce(affected_version,'') || ' ' ||
        tachy_join(symptoms) || ' ' ||
        tachy_join(signals)  || ' ' ||
        tachy_join(tags)
    ) stored,

    -- Two configs on purpose. 'simple' keeps error codes and identifiers exact
    -- (023, ECONNREFUSED, TOO_MANY_STRINGS); 'english' adds stemming so
    -- "printer stopped" finds "printer stops". Searches match against either.
    search_tsv tsvector generated always as (
        to_tsvector('simple',
            coalesce(issue_summary,'') || ' ' ||
            coalesce(root_cause,'')   || ' ' ||
            coalesce(resolution,'')   || ' ' ||
            coalesce(resolution_pattern,'') || ' ' ||
            coalesce(product_area,'') || ' ' ||
            coalesce(cloud,'')        || ' ' ||
            coalesce(affected_version,'') || ' ' ||
            tachy_join(symptoms) || ' ' ||
            tachy_join(signals)  || ' ' ||
            tachy_join(tags)
        )
    ) stored,

    search_tsv_en tsvector generated always as (
        to_tsvector('english',
            coalesce(issue_summary,'') || ' ' ||
            coalesce(root_cause,'')   || ' ' ||
            coalesce(resolution,'')   || ' ' ||
            coalesce(resolution_pattern,'') || ' ' ||
            coalesce(product_area,'') || ' ' ||
            coalesce(cloud,'')        || ' ' ||
            coalesce(affected_version,'') || ' ' ||
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
create index knowledge_customer_idx    on knowledge_entries(customer_id);
create index knowledge_symptoms_idx    on knowledge_entries using gin (symptoms);
create index knowledge_signals_idx     on knowledge_entries using gin (signals);
create index knowledge_tags_idx        on knowledge_entries using gin (tags);
create index knowledge_tsv_idx         on knowledge_entries using gin (search_tsv);
create index knowledge_tsv_en_idx      on knowledge_entries using gin (search_tsv_en);
create index knowledge_trgm_idx        on knowledge_entries using gin (search_text gin_trgm_ops);
create index knowledge_embedding_idx   on knowledge_entries using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);

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
    mode            text not null check (mode in ('ingest','consult','sync','create','code','chat')),
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
    -- Provenance for docs pulled from a project wiki; external_key is the page
    -- path, and (project, page) is what a re-import supersedes instead of
    -- duplicating. Not unique: a new revision is inserted before its predecessor
    -- is archived, inside one transaction.
    source_project_id uuid references source_projects(id) on delete set null,
    external_key      text,
    -- Same taxonomy anchor as knowledge_entries: a doc scoped to a product may
    -- also name the component it documents. Optional on purpose — a general
    -- product doc (onboarding, release process) belongs to the product and to
    -- no single component. product_area is DERIVED from the component hierarchy
    -- at write time, kept as a column so the generated search columns below can
    -- reference it (they can't join other tables).
    component_id  uuid references components(id) on delete set null,
    product_area  text,
    -- Same second axis as knowledge_entries: whose install this documents.
    customer_id   uuid references customers(id) on delete set null,
    title       text not null,
    body        text not null,
    tags        text[] not null default '{}',
    structured  jsonb not null default '{}'::jsonb,
    status      text not null default 'approved'
                    check (status in ('draft','approved','archived')),
    doc_version   text,
    superseded_by uuid references reference_docs(id) on delete set null,

    search_text text generated always as (
        coalesce(title,'') || ' ' || coalesce(body,'') || ' ' ||
        coalesce(product_area,'') || ' ' || coalesce(doc_version,'') || ' ' || tachy_join(tags)
    ) stored,
    search_tsv tsvector generated always as (
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' ||
            coalesce(product_area,'') || ' ' || coalesce(doc_version,'') || ' ' || tachy_join(tags))
    ) stored,
    search_tsv_en tsvector generated always as (
        to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' ||
            coalesce(product_area,'') || ' ' || coalesce(doc_version,'') || ' ' || tachy_join(tags))
    ) stored,

    version     integer not null default 1,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint reference_docs_no_self_supersede check (superseded_by is null or superseded_by <> id)
);

create index reference_docs_product_idx on reference_docs(product_id);
create index reference_docs_component_idx on reference_docs(component_id);
create index reference_docs_customer_idx on reference_docs(customer_id);
create index reference_docs_project_idx on reference_docs(source_project_id, external_key);
create index reference_docs_team_idx    on reference_docs(team_id);
create index reference_docs_status_idx  on reference_docs(status);
create index reference_docs_tags_idx    on reference_docs using gin (tags);
create index reference_docs_tsv_idx     on reference_docs using gin (search_tsv);
create index reference_docs_tsv_en_idx  on reference_docs using gin (search_tsv_en);
create index reference_docs_trgm_idx    on reference_docs using gin (search_text gin_trgm_ops);
create index reference_docs_superseded_idx on reference_docs(superseded_by);

create trigger customer_facts_updated_at
    before update on customer_facts
    for each row execute function set_updated_at();

create trigger reference_docs_updated_at
    before update on reference_docs
    for each row execute function set_updated_at();

create table reference_doc_chunks (
    id          uuid primary key default gen_random_uuid(),
    doc_id      uuid not null references reference_docs(id) on delete cascade,
    ordinal     integer not null,
    chunk_text  text not null,
    embedding   vector(768),
    unique (doc_id, ordinal)
);

create index reference_doc_chunks_doc_idx       on reference_doc_chunks(doc_id);
create index reference_doc_chunks_embedding_idx on reference_doc_chunks using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);
create index reference_doc_chunks_trgm_idx      on reference_doc_chunks using gin (chunk_text gin_trgm_ops);

-- Linked git repositories for code consultation. Clones live on disk under
-- TACHY_REPO_DIR; only chunk text + embeddings are stored here. Indexing is
-- on-demand (API route / CLI), diff-only by blob sha; indexed_commit advances
-- only on success so an interrupted run retries the same diff.
create table repos (
    id              uuid primary key default gen_random_uuid(),
    slug            text not null unique,
    url             text not null,
    product_id      uuid references products(id) on delete set null,
    source_slug     text references source_connections(slug) on delete set null,
    source_project_id uuid references source_projects(id) on delete set null,
    -- one component per repo; linkRepo enforces that it belongs to product_id
    component_id    uuid references components(id) on delete set null,
    -- set only for a customer's own addon repo; null is shared product code, which
    -- is why a customer-filtered code search returns both rather than just theirs
    customer_id     uuid references customers(id) on delete set null,
    default_branch  text not null default 'main',
    config          jsonb not null default '{}'::jsonb,
    index_status    text not null default 'idle'
                        check (index_status in ('idle','cloning','indexing','ready','error')),
    indexed_commit  text,
    index_error     text,
    file_count      integer not null default 0,
    chunk_count     integer not null default 0,
    last_indexed_at timestamptz,
    created_at      timestamptz not null default now()
);

create index repos_product_idx   on repos(product_id);
create index repos_project_idx   on repos(source_project_id);
create index repos_component_idx on repos(component_id);
create index repos_customer_idx  on repos(customer_id);

create table repo_files (
    id          uuid primary key default gen_random_uuid(),
    repo_id     uuid not null references repos(id) on delete cascade,
    path        text not null,
    lang        text,
    blob_sha    text not null,
    size_bytes  integer not null,
    unique (repo_id, path)
);

create index repo_files_repo_idx      on repo_files(repo_id);
create index repo_files_path_trgm_idx on repo_files using gin (path gin_trgm_ops);

create table code_chunks (
    id          uuid primary key default gen_random_uuid(),
    repo_id     uuid not null references repos(id) on delete cascade,
    file_id     uuid not null references repo_files(id) on delete cascade,
    ordinal     integer not null,
    start_line  integer not null,
    end_line    integer not null,
    chunk_text  text not null,
    embedding   vector(768),
    unique (file_id, ordinal)
);

create index code_chunks_repo_idx      on code_chunks(repo_id);
create index code_chunks_embedding_idx on code_chunks using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);
create index code_chunks_trgm_idx      on code_chunks using gin (chunk_text gin_trgm_ops);
