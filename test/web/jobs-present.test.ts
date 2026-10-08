/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { describeSchedule } from "../../packages/web/src/jobs/cron";
import {
  hasLog,
  lastResult,
  startedBy,
  statusMark,
  waitingText,
} from "../../packages/web/src/jobs/status";

const title = (k: string) => `title of ${k}`;
const base = {
  kind: "repo.reindex",
  requested_by_name: null,
  parent_id: null,
  parent_kind: null,
  parent_name: null,
};

describe("a schedule in words", () => {
  it.each([
    ["7 * * * *", "every hour at :07"],
    ["0 * * * *", "every hour"],
    ["*/15 * * * *", "every 15 min"],
    ["* * * * *", "every minute"],
    ["30 3 * * *", "daily at 03:30"],
    ["0 9 * * 1-5", "weekdays at 09:00"],
    ["0 10 * * 0,6", "weekends at 10:00"],
    ["15 8 * * 1,3", "Mon, Wed at 08:15"],
    ["0 0 1 * *", "0 0 1 * *"],
    ["1-5 * * * *", "1-5 * * * *"],
    ["0 9 * * MON", "0 9 * * MON"],
    ["not cron", "not cron"],
  ])("%s -> %s", (cron, said) => {
    expect(describeSchedule(cron)).toBe(said);
  });
});

describe("run status", () => {
  it("gives every status a mark, and an unknown one a muted one", () => {
    expect(statusMark("succeeded")).toMatchObject({ tone: "ok" });
    expect(statusMark("timed_out")).toMatchObject({
      tone: "danger",
      label: "timed out",
    });
    expect(statusMark("queued").label).toBe("waiting");
    expect(statusMark("odd_state")).toMatchObject({
      tone: "muted",
      label: "odd state",
    });
  });

  it("summarises a job's last run for its row", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(lastResult(null, now).text).toBe("never run");
    expect(
      lastResult({ status: "failed", created_at: "2026-10-05T10:00:00Z" }, now),
    ).toMatchObject({
      tone: "danger",
      text: "failed 2 h ago",
      short: "2 h ago",
    });
    expect(
      lastResult(
        { status: "running", created_at: "2026-10-05T11:59:00Z" },
        now,
      ),
    ).toMatchObject({ text: "running", short: "running" });
    expect(
      lastResult({ status: "succeeded", created_at: "garbage" }, now).text,
    ).toBe("succeeded");
  });

  it("offers the log once it holds more than one line", () => {
    expect(hasLog("")).toBe(false);
    expect(hasLog("indexing portal\n")).toBe(false);
    expect(hasLog("indexing portal\n12 files")).toBe(true);
  });
});

describe("who started a run", () => {
  it("names a schedule, a person, and the run that fanned an event out", () => {
    expect(startedBy({ ...base, trigger: "schedule" }, title)).toEqual({
      icon: "startedBySchedule",
      who: "schedule",
    });
    expect(
      startedBy(
        { ...base, trigger: "manual", requested_by_name: "Ana" },
        title,
      ),
    ).toEqual({ icon: "startedByPerson", who: "Ana" });
    expect(startedBy({ ...base, trigger: "manual" }, title).who).toBe(
      "someone",
    );
    expect(
      startedBy(
        {
          ...base,
          trigger: "event",
          parent_id: "p",
          parent_kind: "repos.refresh",
          parent_name: "Nightly index",
        },
        title,
      ).who,
    ).toBe("Nightly index");
    expect(
      startedBy(
        {
          ...base,
          trigger: "event",
          parent_id: "p",
          parent_kind: "repos.refresh",
        },
        title,
      ).who,
    ).toBe("title of repos.refresh");
    expect(
      startedBy({ ...base, trigger: "event", parent_id: "p" }, title).who,
    ).toBe("another run");
  });

  it("names what fires an event that no run queued", () => {
    expect(
      startedBy({ ...base, kind: "flow.run", trigger: "event" }, title).who,
    ).toBe("flow trigger");
    expect(
      startedBy({ ...base, kind: "bucket.embed", trigger: "event" }, title).who,
    ).toBe("upload");
    expect(startedBy({ ...base, trigger: "event" }, title).who).toBe(
      "an event",
    );
  });
});

describe("a run that has not started", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const run = (over: object) => ({
    run_after: "2026-10-05T11:56:00Z",
    created_at: "2026-10-05T11:55:00Z",
    attempts: 0,
    max_attempts: 3,
    ...over,
  });

  it("says how long it has waited, from when it was due", () => {
    expect(waitingText(run({}), now)).toBe("waiting 4 min");
    expect(waitingText(run({ run_after: "2026-10-05T11:59:40Z" }), now)).toBe(
      "waiting",
    );
    expect(waitingText(run({ run_after: "", created_at: "bad" }), now)).toBe(
      "waiting",
    );
  });

  it("says which try a retry is", () => {
    expect(waitingText(run({ attempts: 1 }), now)).toBe("retry 2 of 3");
  });
});
