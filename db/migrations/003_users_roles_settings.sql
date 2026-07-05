-- 003: user roles + password login + DB-backed runtime settings.
-- users gains a global role (admin | member), an optional password hash
-- (null = SSO-only or attribution-only user), and a disabled flag.
-- settings is a key-value store for NON-SECRET runtime config (redaction,
-- agent cost policy, org name) managed via the web wizard / Admin > System;
-- secrets stay in the environment, never in the database.
-- Idempotent; mirrored in db/schema.sql (canonical for fresh installs).
-- NO explicit begin/commit here: the appliers (`tachy migrate`, test setup) wrap
-- each file in a transaction; psql users should use --single-transaction.

alter table users add column if not exists role text not null default 'member';
alter table users add column if not exists password_hash text;
alter table users add column if not exists disabled boolean not null default false;

update users set role = 'member' where role not in ('admin','member');
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
    check (role in ('admin','member'));

create table if not exists settings (
    key         text primary key,
    value       jsonb not null,
    updated_at  timestamptz not null default now()
);
