# A job or a flow keeps failing

```sh
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
```

**Where it shows.** Admin › workers › failed jobs lists every definition whose
last run failed. tachy-watch posts `jobs` to Teams: a warning for a failed,
stuck or disabled job, a failure when a schedule is overdue or a queue has no
worker. A definition with `notify` on also posts to the job workflow by itself.

**Read the run.** Admin › workers › runs, then the run: its error, its
progress note and the last 200 lines it logged. The rest is in the worker that
ran it:

```sh
$C logs --since 6h worker-light worker-heavy | grep <run id>
```

`index`, `embed` and `testing` runs are in `worker-heavy`; `sync`, `flows` and
`maintenance` runs are in `worker-light`.

| What the run says                              | Do                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 401 or 403 from a source                       | the token expired or lost a scope: [credentials.md](credentials.md), then run now                      |
| 429 from a source                              | Admin › integrations › sources shows the rate limit; widen the schedule                                |
| `timed_out`                                    | raise the definition's timeout, or find why the run got slow ([investigation.md](investigation.md))    |
| the definition is off with a reason            | its stored parameters no longer fit the kind after a release: edit them, save, and switch it on        |
| `canceling statement due to statement timeout` | a single statement ran past the 60 s that `tachy_app` allows; that is a bug in the kind, not a setting |

**Run it again.** `run now` on the definition, under Admin › workers › jobs.
`stop` on a run cancels it. Pausing a definition stops its schedule and leaves
its history.

**Nothing is running at all.** A schedule that is overdue, or a queue with runs
and no worker, means a worker is down:

```sh
$C ps worker-light worker-heavy
$C logs --tail 50 worker-light worker-heavy
$C up -d worker-light worker-heavy
```

Admin › workers › workers lists each worker with the queues it claims from and
when it last reported. After downtime a schedule runs once for everything it
missed, or skips it, as its kind says.

**A flow.** Each pass of a flow over one item is a `flow.run` on the `flows`
queue, so everything above applies. Admin › flows, the flow, then its runs: each
run shows every step with what it received and returned.

- A flow acts with its owner's source tokens and model credential. When the
  owner's token expired, or the owner was disabled, every step that writes or
  asks the model fails: give the flow an owner whose credentials work.
- Switch the flow off while fixing it. A flow that is on runs again for each
  new item.
- A dry run executes the reads and records what each write would have done.
