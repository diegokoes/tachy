# Investigating

Every log line is one JSON object with an `event` and, for anything a request
caused, `req`. MCP children's lines arrive in the api log with `source: "mcp"`
and the turn id.

```sh
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
$C logs --since 1h api | grep <request id>
```

**Slow search.** Admin › system: event-loop delay and the embedding queue. A
passage backlog (a reference save, a reindex) delays queries by at most one
batch. Then `pg_stat_statements`:
`$C exec -T postgres psql -U tachy -d tachy -c "select calls, mean_exec_time, query from pg_stat_statements order by mean_exec_time desc limit 5"`.

**A stuck or expensive turn.** Admin › system shows slots, queued turns and
the oldest waiting approval. A turn whose browser went away with no approval
pending is stopped within 30 s; one waiting on an approval ends when the
approval times out (15 min). Its cost is in `analysis_runs` by `turn_id`.
Turn ids: `$C logs api | jq -r 'select(.turn) | .turn' | sort | uniq -c`.

**A failed sync.** `$C run --rm cli npm run sync <connection>` shows the error
directly. Admin › integrations › sources lists auth failures and rate limits per
connection.

**A failed index.** `$C logs api | grep repo_index`. Reindex from the repo's
page; an index interrupted by a restart is marked as such at the next boot.

**Memory.** Admin › system: api memory against its limit. Each Claude turn
costs roughly 0.4 GB; the slot cap is the lever.
