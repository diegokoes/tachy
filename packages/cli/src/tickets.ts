import { recordAudit } from "@tachy/core/audit";
import {
  deleteStoredItems,
  filterForAudit,
  previewStoredItems,
  type StoredItemCleanup,
  type StoredItemFilter,
  type StoredItemPreview,
} from "@tachy/core/work-items";

/** The filter the command's flags describe. */
export function storedItemFilterOf(
  flags: Record<string, string>,
): StoredItemFilter {
  return {
    connection: flags.connection,
    statuses: flags.status
      ?.split(",")
      .map((status) => status.trim())
      .filter(Boolean),
    product: flags.product,
    team: flags.team,
    customer: flags.customer,
    requester: flags.requester,
    changedBefore: flags.before,
    includeLearnedFrom: Boolean(flags["include-learned-from"]),
  };
}

/** A preview as the lines the command prints. */
export function previewLines(preview: StoredItemPreview): string[] {
  const lines = [
    `${preview.matched} stored ticket(s) match, with ${preview.messages} message(s)`,
  ];
  if (preview.kept_learned_from)
    lines.push(
      `${preview.kept_learned_from} more match and are left: a knowledge entry was learned from them (--include-learned-from takes them too)`,
    );
  for (const { status, n } of preview.by_status)
    lines.push(`  ${String(n).padStart(6)}  ${status ?? "(no status)"}`);
  for (const item of preview.sample)
    lines.push(
      `  ${item.connection} ${item.external_id}  ${item.status ?? "-"}  ${item.title ?? ""}`,
    );
  return lines;
}

/**
 * Previews, and deletes when `confirmed`. The delete is held to the count the
 * preview just gave, and recorded in the audit trail.
 */
export async function cleanStoredItems(
  filter: StoredItemFilter,
  confirmed: boolean,
): Promise<{ preview: StoredItemPreview; cleanup?: StoredItemCleanup }> {
  const preview = await previewStoredItems(filter);
  if (!confirmed || preview.matched === 0) return { preview };
  const cleanup = await deleteStoredItems(filter, preview.matched);
  await recordAudit({
    actor: { userId: null, actor: "api" },
    action: "work_items_cleanup",
    target: filter.connection ?? "every connection",
    detail: { ...filterForAudit(filter), ...cleanup, by: "cli" },
  });
  return { preview, cleanup };
}

/** The whole command: the lines it prints, having deleted when `--yes` was given. */
export async function cleanTicketsCommand(
  flags: Record<string, string>,
): Promise<string[]> {
  const confirmed = Boolean(flags.yes);
  const { preview, cleanup } = await cleanStoredItems(
    storedItemFilterOf(flags),
    confirmed,
  );
  const lines = previewLines(preview);
  if (cleanup)
    lines.push(
      `deleted ${cleanup.deleted} ticket(s) and ${cleanup.messages} message(s)`,
    );
  else if (preview.matched > 0)
    lines.push("nothing deleted; pass --yes to delete what matches");
  return lines;
}
