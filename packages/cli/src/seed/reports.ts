import { insertRows, type Tx } from "./batches";
import { chance, pastDate, pick, rngFor, uuidFor } from "./deterministic";
import type { SeededUser } from "./org";
import type { Volumes } from "./scale";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type Status = (typeof STATUSES)[number];

interface Draft {
  title: string;
  body: string;
  /** Where the reporter was when they opened the form. */
  from: string;
}

const BUGS: Draft[] = [
  {
    title: "Export button does nothing on Safari",
    body: "Opened a knowledge entry and clicked export → CSV.\nExpected: a download.\nActual: the button spins for a second and nothing happens. Works in Chrome on the same machine.",
    from: "/library",
  },
  {
    title: "Search returns stale results after an edit",
    body: "Edited the root cause of an entry and saved it, then searched for a phrase from the new text.\nExpected: the entry comes up.\nActual: it only matches the old wording until I reload the page a few minutes later.",
    from: "/library",
  },
  {
    title: "Wiki link renders as plain text",
    body: "Wrote [[Printer calibration]] in an article body. The preview shows it as a link, but after saving the article shows the raw brackets.",
    from: "/wiki",
  },
  {
    title: "Chat scrolls to the wrong message on reload",
    body: "In a long conversation, reloading the page scrolls to somewhere in the middle instead of the latest message. Happens every time on a chat with 40+ turns.",
    from: "/chat",
  },
  {
    title: "Admin overview counters flash zero on load",
    body: "Opening admin → integrations, the counters at the top show 0 for about a second before the real numbers appear. Looks like everything is broken at first glance.",
    from: "/admin/integrations",
  },
  {
    title: "Filter by component resets when switching tabs",
    body: "Set the component filter in the library to 'scanner', switched to docs and back to all.\nExpected: filter still applied.\nActual: back to 'any'.",
    from: "/library",
  },
  {
    title: "Attachment upload fails for large PDFs",
    body: "Tried attaching a 14 MB PDF manual in chat. The upload bar reaches the end and then shows 'upload failed' with no reason. Smaller files work.",
    from: "/chat",
  },
  {
    title: "Dates show in UTC instead of my timezone",
    body: "The 'updated' dates in the library are two hours off from my clock (I'm in CEST). The wiki shows the right time.",
    from: "/library",
  },
  {
    title: "Settings accent colour doesn't persist",
    body: "Picked the green accent in settings → appearance. It applies immediately, but after logging out and back in it is blue again.",
    from: "/settings",
  },
  {
    title: "Vim keys fire while typing in the title field",
    body: "With vim controls on, typing a 'j' in the feedback title moved the page instead of typing the letter. Only in that field, the body is fine.",
    from: "/feedback",
  },
  {
    title: "Work item links open the wrong project",
    body: "Clicking a linked ADO work item from an entry opens the item in the 'Platform' project, but it lives in 'Scanners'. The id is right, the project in the URL is not.",
    from: "/library",
  },
  {
    title: "Gap sweep lists a component twice",
    body: "Wiki → gaps shows 'Label printer driver' twice under unwritten, with the same counts. Only started after the category rename yesterday.",
    from: "/wiki",
  },
];

const FEATURES: Draft[] = [
  {
    title: "Bulk-tag knowledge entries",
    body: "After a big import I need to tag 50+ entries with the same customer. Today that is one entry at a time. A multi-select in the library list with 'add tag' would save me an afternoon each time.",
    from: "/library",
  },
  {
    title: "Keyboard shortcut to open the composer",
    body: "I live in the keyboard. A shortcut that focuses the chat composer from anywhere in the app would make the whole thing feel faster.",
    from: "/chat",
  },
  {
    title: "Filter the library by customer",
    body: "We answer per customer. Being able to filter entries and docs by customer (not just product and component) would let me see everything we know about one site at once.",
    from: "/library",
  },
  {
    title: "Export a report thread to PDF",
    body: "When a bug report turns into a customer escalation I have to copy the thread into an email by hand. A PDF export of the report and its replies would help.",
    from: "/admin/system",
  },
  {
    title: "Show who last edited a wiki article",
    body: "The article footer shows when it was updated but not by whom. Knowing who to ask about a page would save a round of messages in the team channel.",
    from: "/wiki",
  },
  {
    title: "Pin a chat to the top",
    body: "I keep one long-running chat per customer escalation. Pinning those so they don't sink below today's quick questions would help me find them.",
    from: "/chat",
  },
  {
    title: "Notify me when a job fails",
    body: "The source syncs fail silently now and then. An in-app notification to admins when a scheduled job fails would mean we notice before users do.",
    from: "/admin/workers",
  },
  {
    title: "Draft wiki articles from resolved tickets",
    body: "When a ticket gets a good resolution, a button to start a wiki article pre-filled from it would turn our support work into documentation with much less effort.",
    from: "/wiki",
  },
  {
    title: "Compare two versions of a doc",
    body: "Reference docs get re-uploaded with each firmware release. A side-by-side diff between the new version and the one it supersedes would show what changed without reading both.",
    from: "/library",
  },
  {
    title: "Light theme for printed wiki pages",
    body: "Printing a wiki article prints the dark background. A print stylesheet that uses the light theme would make handouts for the line operators readable.",
    from: "/wiki",
  },
  {
    title: "Mention a colleague in a report reply",
    body: "When replying to a report I'd like to @mention the engineer who owns the area so they get the notification too, instead of forwarding the link.",
    from: "/admin/system",
  },
  {
    title: "Remember the last filter per section",
    body: "Every time I come back to the library I set the same product filter again. Remembering it per person would save a click I make dozens of times a day.",
    from: "/library",
  },
];

const SUGGESTIONS = [
  "Which browser and version were you on?",
  "What did you expect to happen instead?",
  "Does it happen every time, or only sometimes?",
  "Which customer or product is this about?",
  "What do you do today to work around it?",
];

const AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
];
const VIEWPORTS = ["1440x900", "1920x1080", "1280x800", "2560x1440"];

/** The admin's side of a thread, reply by reply, for how far it got. */
function adminReplies(type: "bug" | "feature", status: Status): string[] {
  if (status === "open") return [];
  if (type === "bug")
    return {
      in_progress: [
        "Thanks, reproduced it on our side. Looking into a fix now.",
      ],
      resolved: [
        "Thanks, reproduced it on our side. Looking into a fix now.",
        "Fixed in today's release. Let us know if you still see it after a reload.",
      ],
      closed: [
        "We couldn't reproduce this with the steps above. Closing for now; reply here if it happens again and we'll reopen it.",
      ],
    }[status];
  return {
    in_progress: [
      "Good idea, and a few people have asked for something similar. We're scoping it for the next cycle.",
    ],
    resolved: [
      "Good idea, and a few people have asked for something similar. We're scoping it for the next cycle.",
      "This is live now. Thanks for the suggestion!",
    ],
    closed: [
      "Thanks for the suggestion. It doesn't fit what we're building right now, so we're not planning it, but we'll keep it on the list.",
    ],
  }[status];
}

const FOLLOW_UPS = [
  "Still happening today, in case that helps.",
  "One more detail: it only started after last week's update.",
  "Happy to jump on a call and show it if that's easier.",
  "A colleague on the same team is seeing it too.",
];

/**
 * A queue of bugs and feature requests at every stage — waiting, being worked
 * on, fixed, and turned down — with the threads and notifications each stage
 * leaves behind. Every report carries the AI review the form now always runs.
 * The first is forced resolved so the message and notification tables are
 * never empty at any scale.
 */
export async function seedReports(
  tx: Tx,
  v: Volumes,
  users: SeededUser[],
): Promise<void> {
  const admins = users.filter((u) => u.role === "admin");
  const members = users.filter((u) => u.role !== "admin");
  const reports: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];

  for (let i = 0; i < v.reports; i++) {
    const rng = rngFor("report", i);
    const reporter = pick(rng, members.length ? members : users);
    const type = chance(rng, 0.55) ? "bug" : "feature";
    const draft = pick(rng, type === "bug" ? BUGS : FEATURES);
    const status: Status = i === 0 ? "resolved" : pick(rng, STATUSES);
    const id = uuidFor("report", i);
    // A thread runs up to about five days, so anything past 'open' was filed
    // early enough for its replies to have happened already.
    const created =
      status === "open"
        ? pastDate(rng, 60)
        : new Date(Date.now() - (6 + rng() * 54) * 86_400_000);
    const held = chance(rng, 0.25);
    reports.push({
      id,
      reporter_id: reporter.id,
      type,
      status,
      title: draft.title,
      body_text: draft.body,
      context: tx.json({
        from: draft.from,
        href: `https://tachy.local/feedback`,
        user_agent: pick(rng, AGENTS),
        viewport: pick(rng, VIEWPORTS),
        env: null,
      }),
      ai_review: tx.json(
        chance(rng, 0.1)
          ? { available: false, ok: true, suggestions: [] }
          : held
            ? {
                available: true,
                ok: false,
                suggestions: [
                  pick(rng, SUGGESTIONS),
                  pick(rng, SUGGESTIONS),
                ].filter((s, k, all) => all.indexOf(s) === k),
              }
            : { available: true, ok: true, suggestions: [] },
      ),
      created_at: created,
      updated_at: created,
    });

    // The thread, spaced out over the days after filing. Every admin reply
    // raised a notification for the reporter, as the reply route does.
    let at = created.getTime();
    const later = () => (at += (2 + Math.floor(rng() * 40)) * 3_600_000);
    const thread: { direction: "admin" | "reporter"; body: string }[] = [];
    if (chance(rng, 0.3))
      thread.push({ direction: "reporter", body: pick(rng, FOLLOW_UPS) });
    for (const body of adminReplies(type, status))
      thread.push({ direction: "admin", body });

    thread.forEach((m, k) => {
      const when = new Date(later());
      const author =
        m.direction === "admin" && admins.length ? pick(rng, admins) : reporter;
      messages.push({
        id: uuidFor("report-msg", i * 10 + k),
        report_id: id,
        author_id: author.id,
        direction: m.direction,
        body_text: m.body,
        created_at: when,
      });
      const read = status === "closed" || chance(rng, 0.4);
      if (m.direction === "admin")
        notifications.push({
          id: uuidFor("report-notif", i * 10 + k),
          user_id: reporter.id,
          kind: "report_reply",
          title:
            type === "bug"
              ? "An admin replied to your bug report"
              : "An admin replied to your feature request",
          body_text: m.body,
          ref: tx.json({ report_id: id }),
          seen_at: read || chance(rng, 0.5) ? when : null,
          read_at: read ? when : null,
          created_at: when,
        });
      reports[reports.length - 1].updated_at = when;
    });
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
