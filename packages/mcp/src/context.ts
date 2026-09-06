import {
  resolveSource,
  ingestWorkItem,
  resolveCurrentUserId,
  sql,
  resolveComponentFilter,
  getProductIdBySlug,
  getCustomerProfile,
  getCustomerSlug,
  resolveRedactionPolicy,
  redactForLlm,
  extractAdoRefs,
  compactForLlm,
  summarizeCompaction,
  getTeamIdBySlug,
  recordAdoRefs,
  badInput,
  listCustomerUnits,
  fetchUntrustedUrl,
  stripHtml,
} from "@tachy/core";
import type { RawWorkItem } from "@tachy/core";
import { extractSource } from "./extract";

/**
 * What a work item comes back with: its transcript compacted, its customer's
 * profile inline, the Azure DevOps items it references already fetched, and
 * whatever freeform sources were handed in alongside it.
 */
export function capTurns<T extends { text: string }>(
  turns: T[],
  maxChars = 30000,
): { turns: T[]; turns_truncated?: { shown: number; of: number } } {
  let used = 0;
  const kept: T[] = [];
  for (const t of turns) {
    if (used + t.text.length > maxChars) continue;
    used += t.text.length;
    kept.push(t);
  }
  return kept.length === turns.length
    ? { turns: kept }
    : {
        turns: kept,
        turns_truncated: { shown: kept.length, of: turns.length },
      };
}

/**
 * The ingest path reads the compacted form when compaction demonstrably helps,
 * so /analyze and /consult stop paying for quoted chains and signatures. Runs
 * AFTER redaction, so the model still never sees unscrubbed text, and never
 * writes: only compact_work_item posts a note.
 */
export function withCompaction(item: RawWorkItem): Record<string, unknown> {
  const { item: forLlm, compacted } = compactForLlm(item);
  if (!compacted) return { item: forLlm };
  const { turns, compaction } = compacted;
  // Bounded here too: compaction only fires above COMPACT_MIN_CHARS, so by
  // construction this array is never small, and on a long ticket it is hundreds
  // of KB going through the same ceiling capTurns exists for.
  const { turns: shown, turns_truncated } = capTurns(turns);
  return {
    item: forLlm,
    transcript: shown,
    ...(turns_truncated ? { transcript_truncated: turns_truncated } : {}),
    compaction: { ...compaction, ...summarizeCompaction(compacted) },
    next: "messages were replaced by transcript: a de-duplicated, attributed turn list with quoted chains, signatures, banners, automated mail and repeats removed. The wording is verbatim — never re-summarise or re-order it. Each turn has speaker, at, kind (reply / internal_note / quoted) and optional attachments; '[image]' marks an inline image, and a turn with empty text but attachments carried only a file. Turns with kind 'quoted' were recovered from quoted history and may predate the ticket — that is mail existing nowhere else in the system, worth reading first. This is a read-path transform and writes nothing to the ticket.",
  };
}

/**
 * The customer's own install, inline on the turn that fetched their ticket.
 * Their version and addons decide whether a general answer even applies, and the
 * model will not think to go and ask — so it arrives unasked, kept short.
 */
export async function withCustomerProfile(
  customerId: string | null | undefined,
): Promise<Record<string, unknown>> {
  if (!customerId) return {};
  const profile = await getCustomerProfile(customerId);
  if (!profile) return {};
  const has =
    profile.facts.length ||
    profile.components.length ||
    profile.repos.length ||
    profile.projects.length;
  if (!has) return {};
  return {
    customer_profile: {
      slug: profile.slug,
      ...(profile.notes ? { notes: profile.notes } : {}),
      ...(profile.facts.length
        ? {
            specifics: profile.facts.map((f) =>
              [f.kind, f.label, f.value].filter(Boolean).join(": "),
            ),
          }
        : {}),
      ...(profile.components.length
        ? { components: profile.components.map((c) => c.slug) }
        : {}),
      ...(profile.repos.length
        ? { repos: profile.repos.map((r) => r.slug) }
        : {}),
      ...(profile.projects.length
        ? { projects: profile.projects.map((p) => p.external_key) }
        : {}),
    },
    customer_profile_note:
      "This is THIS customer's install, not the product in general. Check their version against an entry's affected_version/fixed_version before repeating its advice, and search their own repos for addon behaviour. Anything you learn here that is true only of them belongs on their profile (set_customer_fact), not in a knowledge entry.",
  };
}

/**
 * An unresolved customer is invisible otherwise — the field is simply null, while
 * the ticket usually names the company in a domain or a signature.
 */
export const unresolvedCustomer = (
  customerId: string | null | undefined,
  ambiguity?: string,
) =>
  customerId
    ? {}
    : {
        customer_note: ambiguity
          ? `customer_id is null — ${ambiguity}. Read the ticket for which of them it actually concerns, then set_work_item_customer. Do not guess from the sender's domain.`
          : "customer_id is null — no known customer matched. The sender's own company is often NOT the customer: partners and distributors raise tickets on a customer's behalf, so read who the ticket is about rather than who sent it. If it identifies one, check list_customers, add_customer if it is missing (put the partner's domain in email_domains on the customer they front for), then set_work_item_customer. Propose it in the same review step rather than asking separately.",
      };

/**
 * Surface which part of a customer's estate a ticket might concern, without
 * assigning it. Same discipline as unresolvedCustomer: a confidently wrong
 * attribution files the ticket, the entry learned from it and every future
 * search hit under a place nobody chose, and is not recoverable.
 */
export async function unresolvedUnit(
  customerId: string | null | undefined,
  unitId: string | null | undefined,
  text: string,
): Promise<Record<string, unknown>> {
  if (!customerId || unitId) return {};
  const units = await listCustomerUnits(customerId);
  if (!units.length) return {};
  const haystack = text.toLowerCase();
  const named = units.filter(
    (u) =>
      haystack.includes(u.slug.toLowerCase()) ||
      u.aliases.some((a) => a && haystack.includes(a.toLowerCase())),
  );
  if (!named.length) return {};
  return {
    unit_note:
      `This customer's estate is divided into units, and the ticket names ` +
      `${named.map((u) => `'${u.slug}'`).join(", ")}. Facts recorded against a ` +
      `unit are NOT visible on the customer as a whole — call ` +
      `get_customer_profile with that unit before advising. If the ticket really ` +
      `is about it, propose set_work_item_customer with the unit in the same ` +
      `review step rather than assuming.`,
    unit_candidates: named.map((u) => ({
      slug: u.slug,
      name: u.name,
      kind: u.kind,
    })),
  };
}

export const MAX_LINKED_ITEMS = 5;
export const LINKED_BODY_CHARS = 2000;

/**
 * Fetch the Azure DevOps items a ticket points at and record the links. They
 * carry most of the engineering context, so analysis reads them as a matter of
 * course rather than offering to. Depth 1 only — a linked item's own relations
 * already come back as summaries.
 */
export async function withLinkedAdoItems(
  raw: RawWorkItem,
  fromWorkItemId: string,
): Promise<Record<string, unknown>> {
  const refs = extractAdoRefs(raw);
  if (!refs.length) return {};

  const [ado] = await sql`
    select slug from source_connections where source_type = 'azure-devops' order by slug limit 1
  `;
  if (!ado)
    return {
      linked_ado_refs: refs,
      linked_items_note:
        "no azure-devops connection is configured, so these ids could not be read",
    };

  const wanted = refs.slice(0, MAX_LINKED_ITEMS);
  const { conn, source: src } = await resolveSource(ado.slug as string);
  const redact = resolveRedactionPolicy(conn.config).enabled;
  const items: Record<string, unknown>[] = [];

  for (const externalId of wanted) {
    try {
      const linkedRaw = await src.fetchItem(externalId);
      const stored = await ingestWorkItem(conn.id, linkedRaw);
      const forLlm = redact
        ? redactForLlm(
            linkedRaw,
            src.redactRaw,
            await getCustomerSlug(stored.customerId),
          )
        : linkedRaw;
      const fields = (forLlm.raw as { fields?: Record<string, unknown> })
        ?.fields;
      items.push({
        external_id: externalId,
        work_item_id: stored.id,
        title: forLlm.title,
        state: forLlm.status,
        type: fields?.["System.WorkItemType"] ?? null,
        area_path: forLlm.areaPath ?? null,
        component: stored.componentSlug,
        url: forLlm.externalUrl,
        body: forLlm.messages
          .map((m) => m.bodyText)
          .join("\n\n")
          .slice(0, LINKED_BODY_CHARS),
        message_count: forLlm.messages.length,
      });
    } catch (e) {
      items.push({
        external_id: externalId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await recordAdoRefs(fromWorkItemId, refs, {
    sourceConnectionId: conn.id,
    createdById: await resolveCurrentUserId(),
  });

  return {
    linked_ado_refs: refs,
    linked_items: items,
    ...(refs.length > wanted.length
      ? {
          linked_items_note: `${refs.length} ids referenced; the first ${wanted.length} were read. Fetch the rest with fetch_work_item if they matter.`,
        }
      : {}),
    next: "linked_items are the Azure DevOps items this ticket references, already read and linked — treat them as part of the context and do not fetch them again. Never fetch relations of relations.",
  };
}

export async function resolveScopeIds(opts: {
  product_slug?: string;
  team_slug?: string;
}): Promise<{ productId?: string; teamId?: string }> {
  return {
    productId: opts.product_slug
      ? await getProductIdBySlug(opts.product_slug)
      : undefined,
    teamId: opts.team_slug ? await getTeamIdBySlug(opts.team_slug) : undefined,
  };
}

export async function componentIntoFilter(
  productId: string | undefined,
  component: string | undefined,
  tags: string[] | undefined,
): Promise<{
  tags?: string[];
  componentId?: string;
  componentTags?: string[];
}> {
  const tagFilter = [...(tags ?? [])];
  let componentId: string | undefined;
  let componentTags: string[] | undefined;
  if (component && productId) {
    const f = await resolveComponentFilter(productId, component);
    componentId = f.componentId;
    componentTags = f.componentTags;
    if (f.extraTags) tagFilter.push(...f.extraTags);
  }
  return {
    tags: tagFilter.length ? tagFilter : undefined,
    componentId,
    componentTags,
  };
}

export async function loadContextSources(input: {
  text?: string;
  paths?: string[];
  urls?: string[];
}) {
  const sources: { source: string; text: string; pages?: number }[] = [];
  if (input.text?.trim()) sources.push({ source: "inline", text: input.text });
  for (const p of input.paths ?? []) {
    const { text, pages } = await extractSource(p);
    sources.push({ source: p, text, ...(pages != null ? { pages } : {}) });
  }
  for (const u of input.urls ?? []) {
    const res = await fetchUntrustedUrl("ingest_context", u);
    if (!res.ok) throw badInput(`Failed to fetch ${u}: HTTP ${res.status}`);
    const raw = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    sources.push({
      source: u,
      text: ct.includes("html") ? stripHtml(raw) : raw,
    });
  }
  return sources;
}
