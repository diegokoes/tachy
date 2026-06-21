# Security Policy

## Supported versions

tachý is pre-1.0 and follows [ZeroVer](https://0ver.org): only the latest
commit on `main` is supported. There are no maintained release branches.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://github.com/diegokoes/tachy/security/advisories/new)
for this repo instead.

Since tachý runs as a network service handling real ticket data (Freshdesk and
GitHub content, customer information), please flag anything involving:

- auth bypass on the REST API
- SQL injection or other DB-layer issues
- secrets or tokens leaking into logs, search text, or embeddings
- customer identity leaking into the (deliberately customer-blind)
  `knowledge_entries` search index

I'll fix confirmed issues as soon as I can and credit you in the fix, unless
you'd rather stay anonymous.
