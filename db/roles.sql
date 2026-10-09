-- Least-privilege roles, applied after schema.sql and again on every deploy.
-- Idempotent, because roles are cluster-wide and outlive any one schema apply.
-- Grants cover the current schema. Passwords are never set here;
-- deploy/postgres/role-passwords.sh sets them from the environment.

do $$ begin
    create role tachy_app nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
    create role tachy_backup nologin;
exception when duplicate_object then null;
end $$;

-- The chat tools' subprocess, where the api is given a password for it. A
-- model drives that process, so it gets what the tools need and not the rest.
do $$ begin
    create role tachy_mcp nologin;
exception when duplicate_object then null;
end $$;

-- tachy-watch, from inside the postgres container. It has no password, so it
-- logs in only where pg_hba trusts: the container's own socket and loopback.
do $$ begin
    create role tachy_watch login;
exception when duplicate_object then null;
end $$;

alter role tachy_app set statement_timeout = '60s';

do $$
declare s text := current_schema();
begin
    execute format('grant usage on schema %I to tachy_app', s);
    execute format('grant select, insert, update, delete on all tables in schema %I to tachy_app', s);
    execute format('grant usage, select, update on all sequences in schema %I to tachy_app', s);
    execute format('grant execute on all functions in schema %I to tachy_app', s);
    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to tachy_app', s);
    execute format('alter default privileges in schema %I grant usage, select, update on sequences to tachy_app', s);
    execute format('alter default privileges in schema %I grant execute on functions to tachy_app', s);
end $$;

alter role tachy_mcp set statement_timeout = '60s';

-- tachy_app's grants, then less: no vault, no API tokens, no password hashes,
-- and the audit trail write-only. A new table holding secrets needs a revoke
-- here, because the default below grants it.
do $$
declare s text := current_schema();
begin
    execute format('grant usage on schema %I to tachy_mcp', s);
    execute format('grant select, insert, update, delete on all tables in schema %I to tachy_mcp', s);
    execute format('grant usage, select, update on all sequences in schema %I to tachy_mcp', s);
    execute format('grant execute on all functions in schema %I to tachy_mcp', s);
    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to tachy_mcp', s);
    execute format('alter default privileges in schema %I grant usage, select, update on sequences to tachy_mcp', s);
    execute format('alter default privileges in schema %I grant execute on functions to tachy_mcp', s);

    execute format('revoke all on %I.credentials, %I.api_tokens, %I.users from tachy_mcp', s, s, s);
    -- Enough to record who a tool acted as and to read their rights.
    execute format('grant select (id, email, display_name, role, disabled, service_account, created_at), insert (email, display_name), update (display_name) on %I.users to tachy_mcp', s);
    execute format('revoke select, update, delete, truncate on %I.audit_events from tachy_mcp', s);
end $$;

-- The audit trail is append-only for the application.
do $$
declare s text := current_schema();
begin
    execute format('revoke update, delete, truncate on %I.audit_events from tachy_app', s);
end $$;

grant pg_read_all_data to tachy_backup;
-- Connection counts and the oldest transaction, across every session.
grant pg_monitor to tachy_watch;
-- Admin > System counts connections per process from pg_stat_activity.
grant pg_read_all_stats to tachy_app;
