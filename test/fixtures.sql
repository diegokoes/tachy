-- Minimal, deterministic test data. Applied after schema.sql by
-- test/global-setup.ts -- schema.sql itself ships with no seed data.
insert into teams (slug, name) values ('test-team', 'Test Team')
on conflict (slug) do nothing;

insert into products (team_id, slug, name)
select t.id, p.slug, p.name
from (values
    ('test-team', 'tpd',    'Test Product'),
    ('test-team', 'ftrace', 'Test Product 2')
) as p(team_slug, slug, name)
join teams t on t.slug = p.team_slug
on conflict (team_id, slug) do nothing;

insert into source_connections (source_type, slug, base_url) values
    ('freshdesk', 'test-freshdesk', 'https://test.freshdesk.com')
on conflict (slug) do nothing;

insert into source_product_map (source_connection_id, external_group_key, product_id)
select sc.id, '48000641379', p.id
from source_connections sc
join products p on p.slug = 'tpd'
join teams t on t.id = p.team_id and t.slug = 'test-team'
where sc.slug = 'test-freshdesk'
on conflict (source_connection_id, external_group_key) do nothing;
