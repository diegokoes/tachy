import { insertRows, type Tx } from "./batches";
import { chance, pastDate, pick, rngFor, uuidFor } from "./deterministic";
import type { SeededUser } from "./org";
import type { Volumes } from "./scale";

const TYPES = ["bug", "feature"] as const;
const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

const BUG_TITLES = [
  "export button does nothing on Safari",
  "search returns stale results after an edit",
  "wiki link renders as plain text",
  "chat scrolls to the wrong message on reload",
  "admin overview counters flash zero on load",
];
const FEATURE_TITLES = [
  "bulk-tag knowledge entries",
  "keyboard shortcut to open the composer",
  "dark theme for the print view",
  "filter the library by customer",
  "export a report thread to PDF",
];

const REPLY = "Thanks for flagging this — an update is on the way.";

/**
 * A queue of user reports with a few already answered, so the admin inbox, the
 * thread view and the reporter's notification badge all have something to show
 * on a fresh database. The first is forced answered so those three tables are
 * never empty at any scale.
 */
export async function seedReports(
  tx: Tx,
  v: Volumes,
  users: SeededUser[],
): Promise<void> {
  const admins = users.filter((u) => u.role === "admin");
  const reports: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];

  for (let i = 0; i < v.reports; i++) {
    const rng = rngFor("report", i);
    const reporter = pick(rng, users);
    const type = pick(rng, TYPES);
    const status = i === 0 ? "resolved" : pick(rng, STATUSES);
    const id = uuidFor("report", i);
    const created = pastDate(rng, 90);
    reports.push({
      id,
      reporter_id: reporter.id,
      type,
      status,
      title: pick(rng, type === "bug" ? BUG_TITLES : FEATURE_TITLES),
      body_text:
        type === "bug"
          ? "Steps: opened the page, clicked the control.\nExpected: it works.\nActual: nothing happened."
          : "It would help my team to have this, because today we work around it by hand.",
      context: tx.json({ href: "/library", user_agent: "seed" }),
      ai_review: null,
      created_at: created,
      updated_at: created,
    });

    // Anything past 'open' has been touched: an admin reply and the
    // notification it raised for the reporter.
    if (status !== "open" && admins.length) {
      const admin = pick(rng, admins);
      const repliedAt = new Date(created.getTime() + 3_600_000);
      messages.push({
        id: uuidFor("report-msg", i),
        report_id: id,
        author_id: admin.id,
        direction: "admin",
        body_text: REPLY,
        created_at: repliedAt,
      });
      notifications.push({
        id: uuidFor("report-notif", i),
        user_id: reporter.id,
        kind: "report_reply",
        title:
          type === "bug"
            ? "An admin replied to your bug report"
            : "An admin replied to your feature request",
        body_text: REPLY,
        ref: tx.json({ report_id: id }),
        seen_at: chance(rng, 0.5) ? repliedAt : null,
        read_at: status === "closed" ? repliedAt : null,
        created_at: repliedAt,
      });
    }
  }

  await insertRows(
    tx,
    "reports",
    [
      "id",
      "reporter_id",
      "type",
      "status",
      "title",
      "body_text",
      "context",
      "ai_review",
      "created_at",
      "updated_at",
    ],
    reports,
  );
  await insertRows(
    tx,
    "report_messages",
    ["id", "report_id", "author_id", "direction", "body_text", "created_at"],
    messages,
  );
  await insertRows(
    tx,
    "notifications",
    [
      "id",
      "user_id",
      "kind",
      "title",
      "body_text",
      "ref",
      "seen_at",
      "read_at",
      "created_at",
    ],
    notifications,
  );
}
