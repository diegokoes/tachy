import { registerSource, resolveSource, ingestWorkItem } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";

registerSource("freshdesk", createFreshdeskSource);

async function sync(sourceSlug: string, opts: { since?: string; group?: string }) {
  const { conn, source } = await resolveSource(sourceSlug);
  let cursor: string | undefined;
  let total = 0;
  do {
    const { items, nextCursor } = await source.listItems({
      updatedSince: opts.since, groupKey: opts.group, cursor,
    });
    for (const it of items) {
      await ingestWorkItem(conn.id, it);
      total++;
    }
    cursor = nextCursor;
  } while (cursor);
  console.log(`synced ${total} item(s) from ${sourceSlug}`);
}

const [cmd, sourceSlug, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(
  rest.map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
) as Record<string, string>;

if (cmd === "sync" && sourceSlug) {
  sync(sourceSlug, { since: args.since, group: args.group })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
} else {
  console.log("usage: npm run sync sync <source-slug> [--since=2026-06-01T00:00:00Z] [--group=48000641379]");
  process.exit(1);
}
