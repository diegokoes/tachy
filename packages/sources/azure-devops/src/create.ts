import { addWorkItemLink, recordRun } from "@tachy/core";
import type { CreateContext, NewWorkItem, TicketValidation } from "@tachy/core";
import type { AdoClient, AdoWorkItem, JsonPatchOp } from "./client";

export type { CreateContext, NewWorkItem, PastedImage } from "@tachy/core";

const ATTACHMENT_RE = /attachment:([A-Za-z0-9_-]+)/g;

const HTML_RE =
  /<\/?(p|div|br|ul|ol|li|b|i|em|strong|a|span|h[1-6]|table|tr|td|img|pre|code|blockquote)\b/i;

/** Plain text is escaped and line-broken, so ADO's HTML field shows it as typed. */
export function asHtml(text: string): string {
  return HTML_RE.test(text)
    ? text
    : `<div>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
}

/** Keys the fields actually refer to, so an image the user deleted is not uploaded. */
export function referencedKeys(fields: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const v of Object.values(fields))
    if (typeof v === "string")
      for (const m of v.matchAll(ATTACHMENT_RE)) keys.add(m[1]);
  return keys;
}

export function rewriteAttachments(
  fields: Record<string, unknown>,
  urls: Map<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      typeof v === "string"
        ? v.replace(ATTACHMENT_RE, (m, key: string) => urls.get(key) ?? m)
        : v,
    ]),
  );
}

export function buildPatch(
  orgUrl: string,
  item: Omit<NewWorkItem, "project" | "type" | "images">,
): JsonPatchOp[] {
  const merged: Record<string, unknown> = {
    ...(item.defaults ?? {}),
    ...(item.fields ?? {}),
  };
  merged["System.Title"] = item.title;
  if (item.description != null)
    merged["System.Description"] = asHtml(item.description);
  if (item.tags?.length) merged["System.Tags"] = item.tags.join("; ");

  const patch: JsonPatchOp[] = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ({ op: "add", path: `/fields/${k}`, value: v }));
  const relation = (rel: string, id: string): JsonPatchOp => ({
    op: "add",
    path: "/relations/-",
    value: { rel, url: `${orgUrl}/_apis/wit/workItems/${id}` },
  });
  if (item.parentId)
    patch.push(relation("System.LinkTypes.Hierarchy-Reverse", item.parentId));
  for (const id of item.relatedIds ?? [])
    patch.push(relation("System.LinkTypes.Related", id));
  return patch;
}

/** Runs the type's rules without saving. Images are left as references. */
export async function validateWorkItem(
  client: AdoClient,
  item: NewWorkItem,
): Promise<AdoWorkItem> {
  return client.createWorkItem(
    item.project,
    item.type,
    buildPatch(client.orgUrl, item),
    { validateOnly: true },
  );
}

/**
 * Uploads the pasted images the fields still refer to, points their `src` at
 * the uploads, creates the item, and records who raised it from what.
 */
export async function createWorkItem(
  client: AdoClient,
  item: NewWorkItem,
  ctx: CreateContext,
): Promise<{ id: number; url: string }> {
  let fields = item.fields ?? {};
  const wanted = referencedKeys(fields);
  const images = (item.images ?? []).filter((i) => wanted.has(i.key));
  if (images.length) {
    const urls = new Map<string, string>();
    for (const img of images) {
      const ref = await client.uploadAttachment(
        item.project,
        img.name,
        img.bytes,
      );
      urls.set(img.key, ref.url);
    }
    fields = rewriteAttachments(fields, urls);
  }

  const created = await client.createWorkItem(
    item.project,
    item.type,
    buildPatch(client.orgUrl, { ...item, fields }),
  );
  await recordRun({
    userId: ctx.userId,
    mode: "create",
    meta: {
      source: ctx.sourceSlug,
      project: item.project,
      type: item.type,
      ado_id: created.id,
      ...(images.length ? { images: images.length } : {}),
    },
  });
  for (const from of ctx.workItemIds ?? [])
    await addWorkItemLink({
      fromWorkItemId: from,
      toSourceProjectId: ctx.sourceProjectId ?? null,
      toExternalId: String(created.id),
      kind: "tracked_by",
      createdById: ctx.userId,
    });
  return {
    id: created.id,
    url:
      created._links?.html?.href ??
      `${client.orgUrl}/${encodeURIComponent(item.project)}/_workitems/edit/${created.id}`,
  };
}

/**
 * ADO's rule errors name fields in prose: "Rule Error for field Severity",
 * "field 'System.AreaPath'". Pulled out so the form can mark them.
 */
export function explainAdoError(raw: string): TicketValidation {
  const json = raw.slice(raw.indexOf("{"));
  let message = raw;
  try {
    const parsed = JSON.parse(json) as { message?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    message = raw.replace(/^Azure DevOps \S+ \S+ -> \d+ /, "");
  }
  const fields = new Set<string>();
  for (const m of message.matchAll(/field '([^']+)'/g)) fields.add(m[1]);
  for (const m of message.matchAll(/for field ([^.'"]+?)\./g))
    fields.add(m[1].trim());
  return {
    ok: false,
    message,
    ...(fields.size ? { fields: [...fields] } : {}),
  };
}
