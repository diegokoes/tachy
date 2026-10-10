# Adding a person, a team, a source, a linked repo or a bucket

All of it is done in the admin page by an app admin. None of it needs the host
or a deploy.

**A person.** Under SSO only accounts an admin has added are let in. Admin ›
access › users & roles adds one by email, with no password; the person then
signs in with SSO. Someone who signs in first is told to ask an admin, and gets
no account. Admin › system › `SSO sign-in` set to `anyone the provider lets in`
gives every person the provider authenticates a member account on first
sign-in.

**A team.** Admin › structure › teams creates it. Admin › users › teams puts
people in it and names its admins. A team with no admin is listed as an issue
on the overview.

**A source connection** (Freshdesk, GitHub, Azure DevOps).

1. Admin › integrations › sources: add the connection with its type, a slug and
   its base URL. The slug names the connection in tool calls and in the vault.
2. Store a token for it. A token can be the organisation's, a team's or one
   person's; a turn uses the most specific one its caller has. Tokens need the
   vault (`TACHY_SECRET_KEY`); without it they come from `.env` as
   `<PROVIDER>_TOKEN_<SLUG>`.
3. Admin › system › checks: the connection answers its test call.
4. Admin › integrations › projects: add the projects to read from it, and what
   each maps to.
5. A `source.sync` job for the connection, under Admin › workers › jobs, is
   optional. It copies each project's item rows (title, status, requester) for
   the counts on the admin page. The agent reads a ticket live when it is asked
   about one, with or without the job.

The host must be able to reach the source: add it to the egress list if the
office firewall keeps one.

**A linked repo.** Admin › integrations › repos links one; `bulk link` links
many from a source connection. Linking queues a `repo.reindex` run in
`worker-heavy`, which clones into the `tachy-repo-data` volume and embeds what
it finds. `repos.refresh` reindexes every linked repo nightly at 02:40 UTC.

- The first index of a large repo takes long on the laptop: about 13 chunks a
  second. It holds 3 chat slots while it runs, so link large repos outside
  working hours.
- A private repo needs the connection's token to carry read access to it.
- Folders and file types to leave out are set on the repo's page.

**A bucket** (documents pushed from outside, such as a Document360 export).

1. Admin › integrations › buckets: create it and choose the teams that may read
   it. The ingest token is shown once.
2. Give the token to the pusher, the script that holds the documents. It posts
   batches of at most 16 MB to `https://<host>/ingest/buckets/<slug>/batches`
   with `Authorization: Bearer <token>`.
3. Each batch queues a `bucket.embed` run. The bucket's page shows its
   documents and its last batch.
4. To replace a token, rotate it on the bucket's page and update the pusher. Ten
   failed tokens in a minute from one address stop that address for the rest
   of the minute.
