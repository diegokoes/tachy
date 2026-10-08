import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createReport,
  listMyReports,
  listReports,
  getReport,
  addReportMessage,
  setReportStatus,
  reportsCensus,
} from "@tachy/core/reports";
import {
  notify,
  listNotifications,
  unreadCount,
  markSeen,
  markRead,
} from "@tachy/core/notifications";
import { createUser } from "@tachy/core/access";
import { reviewReport } from "../../packages/agent/src/report-review";
import { resetData, sql } from "../database";
import { disableVault } from "../vault";

afterAll(() => sql.end());

describe("reports domain", () => {
  beforeEach(resetData);

  it("stores a report, threads a reply, and moves its status", async () => {
    const reporter = await createUser({ email: "reporter@example.com" });
    const admin = await createUser({
      email: "admin@example.com",
      role: "admin",
    });

    const report = await createReport({
      reporterId: reporter.id,
      type: "bug",
      title: "export does nothing",
      body: "clicked export, got no file",
      context: { href: "/library" },
    });
    expect(report.status).toBe("open");

    const mine = await listMyReports(reporter.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].reporter_name).toBe("reporter@example.com");

    await addReportMessage({
      reportId: report.id,
      authorId: admin.id,
      direction: "admin",
      body: "thanks - which browser?",
    });

    const full = await getReport(report.id);
    expect(full.messages).toHaveLength(1);
    expect(full.messages?.[0].direction).toBe("admin");

    const moved = await setReportStatus(report.id, "resolved");
    expect(moved.status).toBe("resolved");
    expect((await listReports({ status: "open" })).length).toBe(0);
    expect((await listReports({ status: "resolved" })).length).toBe(1);
  });

  it("counts the queue by status and type", async () => {
    const user = await createUser({ email: "u@example.com" });
    await createReport({ reporterId: user.id, type: "bug", body: "a" });
    await createReport({ reporterId: user.id, type: "bug", body: "b" });
    const feat = await createReport({
      reporterId: user.id,
      type: "feature",
      body: "c",
    });
    await setReportStatus(feat.id, "in_progress");

    const census = await reportsCensus();
    expect(census.reports).toBe(3);
    expect(census.open).toBe(2);
    expect(census.in_progress).toBe(1);
    expect(census.bugs).toBe(2);
    expect(census.features).toBe(1);
    expect(census.oldest_open_at).not.toBeNull();
  });
});

describe("notifications domain", () => {
  beforeEach(resetData);

  it("delivers, counts unread, and marks seen then read", async () => {
    const user = await createUser({ email: "n@example.com" });
    const n = await notify({
      userId: user.id,
      kind: "report_reply",
      title: "an admin replied",
      body: "fixed in the next release",
      ref: { report_id: "abc" },
    });
    expect(n.read_at).toBeNull();
    expect(await unreadCount(user.id)).toBe(1);

    await markSeen(user.id);
    const afterSeen = await listNotifications(user.id);
    expect(afterSeen[0].seen_at).not.toBeNull();
    expect(afterSeen[0].read_at).toBeNull();
    expect(await unreadCount(user.id)).toBe(1);

    await markRead(user.id, [n.id]);
    expect(await unreadCount(user.id)).toBe(0);
  });

  it("keeps each person's inbox to themselves", async () => {
    const a = await createUser({ email: "a2@example.com" });
    const b = await createUser({ email: "b2@example.com" });
    await notify({ userId: a.id, kind: "report_reply", body: "for a" });
    expect(await listNotifications(b.id)).toHaveLength(0);
    // b marking read must not touch a's row.
    await markRead(b.id, [(await listNotifications(a.id))[0].id]);
    expect(await unreadCount(a.id)).toBe(1);
  });
});

describe("reviewReport advisory fallback", () => {
  beforeEach(resetData);

  it("reports unavailable when no credential resolves, without calling a model", async () => {
    disableVault();
    const saved = {
      key: process.env.ANTHROPIC_API_KEY,
      oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      const review = await reviewReport("something broke", "bug", {}, null);
      expect(review.available).toBe(false);
      expect(review.ok).toBe(true);
      expect(review.suggestions).toEqual([]);
    } finally {
      if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.oauth) process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.oauth;
    }
  });
});
