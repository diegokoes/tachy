import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import {
  registerSource,
  resolveSource,
  ingestWorkItem,
  saveKnowledgeEntry,
  searchKnowledge,
  updateKnowledgeEntry,
  resolveCurrentUserId,
  addFeedback,
  recordRun,
  sql,
  countAdmins,
  forbidden,
  canManageTeam,
  assertCanEditScope,
  assertAnyTeamAdmin,
  assertGlobalAdmin,
  listResolutionPatterns,
  addResolutionPattern,
  listComponents,
  addComponent,
  resolveComponentFilter,
  getProductIdBySlug,
  listCustomers,
  addCustomer,
  getCustomerIdBySlug,
  getCustomerProfile,
  setCustomerFact,
  deleteCustomerFact,
  listCustomerFactKinds,
  linkCustomerComponent,
  unlinkCustomerComponent,
  setWorkItemCustomer,
  setObservedVersion,
  getCustomerName,
  getCustomerSlug,
  resolveRedactionPolicy,
  redactForLlm,
  extractAdoRefs,
  compactWorkItem,
  compactForLlm,
  summarizeCompaction,
  renderCompactHtml,
  splitNoteBody,
  listRepos,
  searchCode,
  readCodeFile,
  getArtifactBySlug,
  userSoleTeamId,
  createOutput,
  renderTable,
  outputFilename,
  tableColumnSchema,
  TABLE_FORMATS,
  globalRedactionEnabled,
  scrubDeep,
  scrubText,
  TokenMap,
  loadSettingsIntoEnv,
  listTeams,
  addTeam,
  listProducts,
  addProduct,
  listLabels,
  addLabel,
  getTeamIdBySlug,
  getKnowledgeEntry,
  listKnowledgeEntries,
  listEnvironments,
  saveReferenceDoc,
  getReferenceDoc,
  listReferenceDocs,
  updateReferenceDoc,
  searchReferenceDocs,
  embedQueryLiteral,
  referenceDocLineage,
  listSourceConnections,
  addSourceConnection,
  SOURCE_PROJECT_ROLES,
  listSourceProjects,
  addSourceProject,
  setProjectAreaMap,
  sourceProjectScope,
  resolveProjectContext,
  resolveProjectContextStrict,
  matchWiki,
  recordAdoRefs,
  addWorkItemLink,
  resolveComponentStrict,
  AppError,
  log,
  cloudSchema,
  resolutionClaritySchema,
  badInput,
  knowledgeStatusSchema,
  referenceStatusSchema,
  confidenceSchema,
  feedbackKindSchema,
  runModeSchema,
  env,
  draftSources,
  wikiToc,
  findArticle,
  setArticleCategories,
  setComposedFrom,
  listCustomerUnits,
  addCustomerUnit,
  fetchUntrustedUrl,
  workItemScope,
  externalWorkItemScope,
} from "@tachy/core";
import type {
  ActorRef,
  EntryScope,
  KnowledgeUpdateInput,
  ReferenceDocUpdate,
  RawWorkItem,
} from "@tachy/core";
import { pathToFileURL } from "node:url";
import { extractSource } from "./extract";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import {
  createAzureDevopsSource,
  createAdoClient,
  workItemSchema,
} from "@tachy/source-azure-devops";
import type { AdoClient, JsonPatchOp } from "@tachy/source-azure-devops";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);

const server = new McpServer({ name: "tachy", version: "0.1.0" });

/**
 * The single most common tool-call mistake is passing the source *type* here.
 * Every tool that takes one reuses this so the correction travels with the field
 * rather than living in the system prompt.
 */
const sourceSlug = z
  .string()
  .describe(
    "Source CONNECTION SLUG from list_source_connections (e.g. 'osapiens-freshdesk'), never the source type ('freshdesk', 'azure-devops'). Call list_source_connections first if you do not have it.",
  );

function out(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2),
      },
    ],
  };
}

/**
 * Tool results have a size ceiling; a whole transcript blows it, so turns ship
 * bounded. Skips what does not fit rather than stopping at it — one long turn
 * early in a ticket used to end the walk, and the model got `shown: 0` on a
 * transcript that had plenty of readable turns after it.
 */
function capTurns<T extends { text: string }>(
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
function withCompaction(item: RawWorkItem): Record<string, unknown> {
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
async function withCustomerProfile(
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
const unresolvedCustomer = (
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
async function unresolvedUnit(
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

function outScrubbed(obj: unknown) {
  return out(globalRedactionEnabled() ? scrubDeep(obj, new TokenMap()) : obj);
}

/**
 * Raw cos_sim / fts_rank / trgm_sim / rrf are uninterpretable without knowing
 * each signal's scale, and they cost context on every row. `relevance` (0-1) and
 * `grade` carry the same information in a form the model can act on.
 */
function forAgent<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map(
    ({
      cos_sim,
      fts_rank,
      trgm_sim,
      rrf,
      customer_id,
      customer_slug,
      ...rest
    }) => ({
      ...rest,
      // One spelling of the customer across all three search surfaces, and the
      // slug rather than the uuid — the uuid is not something to cite or filter by.
      ...(customer_slug ? { customer: customer_slug } : {}),
    }),
  );
}

/**
 * An empty result is an answer. Saying so explicitly stops the model filling the
 * silence with a plausible-sounding recollection.
 */
const NO_MATCHES =
  "no entries cleared the relevance floor for this query — the archive has nothing on this. Say so rather than inferring an answer.";

/** Calibration for the scores every search returns; shared so the three stay in step. */
const GRADE_NOTE =
  "Each hit carries relevance (0-1) and grade (strong / good / weak), calibrated against the embedding model's measured distribution: a weak hit is context, not an answer, and saying so beats presenting it as a prior case. Re-running the same search with reworded queries to force a hit is not research.";

/**
 * Fires whenever a result set is not uniformly general. Said once per call, on
 * the results themselves, because attribution is only wrong at the moment the
 * answer is written — and a mixed list is exactly where one install's fix gets
 * retold as how the product behaves.
 */
const CUSTOMER_NOTE =
  "Some hits carry a `customer`: that material came from one customer's install and must be attributed to them by name — never restated as general product behaviour. Hits with customer null are general. Where the two disagree, say so rather than merging them.";

function searchOut(rows: Record<string, unknown>[], kind: string) {
  const trimmed = forAgent(rows);
  if (!trimmed.length)
    return outScrubbed({ results: [], note: `${kind}: ${NO_MATCHES}` });
  const scoped = rows.some((r) => r.customer_slug ?? r.customer);
  return outScrubbed(
    scoped ? { results: trimmed, note: CUSTOMER_NOTE } : trimmed,
  );
}

const MAX_LINKED_ITEMS = 5;
const LINKED_BODY_CHARS = 2000;

/**
 * Fetch the Azure DevOps items a ticket points at and record the links. They
 * carry most of the engineering context, so analysis reads them as a matter of
 * course rather than offering to. Depth 1 only — a linked item's own relations
 * already come back as summaries.
 */
async function withLinkedAdoItems(
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

async function resolveScopeIds(opts: {
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

async function componentIntoFilter(
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

type ToolConfig<I extends ZodRawShape> = {
  description?: string;
  inputSchema?: I;
  annotations?: Record<string, unknown>;
};

export async function runTool(
  name: string,
  cb: (args: unknown, extra: unknown) => unknown,
  args: unknown,
  extra: unknown,
) {
  const started = Date.now();
  try {
    const res = await cb(args, extra);
    log("info", "mcp_tool", { tool: name, ok: true, ms: Date.now() - started });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "mcp_tool", {
      tool: name,
      ok: false,
      ms: Date.now() - started,
      ...(err instanceof AppError ? { code: err.code } : {}),
      error: message,
    });
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

function tool<I extends ZodRawShape>(
  name: string,
  config: ToolConfig<I>,
  cb: ToolCallback<I>,
): void {
  const wrapped = ((args: unknown, extra: unknown) =>
    runTool(
      name,
      cb as (a: unknown, e: unknown) => unknown,
      args,
      extra,
    )) as ToolCallback<I>;
  server.registerTool(name, config as never, wrapped);
}

let enforcementCache = false;
async function enforcementActive(): Promise<boolean> {
  if (enforcementCache) return true;
  enforcementCache = (await countAdmins()) > 0;
  return enforcementCache;
}

/**
 * Who this subprocess is writing as. The user is the same either way — the API
 * builds this env per turn from the caller's session — so `actor` is what says
 * whether an edit came from an agent turn or from someone's own MCP client.
 */
async function mcpActor(): Promise<ActorRef> {
  return {
    userId: await resolveCurrentUserId(),
    actor: env.actor === "agent" ? "agent" : "mcp",
    turnId: env.turnId ?? null,
  };
}

async function gateUserId(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  if (!userId) return null;
  return (await enforcementActive()) ? userId : null;
}

async function requireCanEdit(scope: EntryScope): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertCanEditScope(userId, scope);
}

async function requireCanManageTeam(
  teamId: string | null | undefined,
): Promise<void> {
  const userId = await gateUserId();
  if (!userId) return;
  if (!teamId || !(await canManageTeam(userId, teamId)))
    throw forbidden("you don't have admin rights for this team");
}

async function requireAnyTeamAdmin(): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertAnyTeamAdmin(userId);
}

async function requireGlobalAdmin(): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertGlobalAdmin(userId);
}

async function knowledgeEntryScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from knowledge_entries where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

async function referenceDocScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from reference_docs where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

async function newEntryScope(i: {
  productId?: string | null;
  teamId?: string | null;
  workItemId?: string | null;
}): Promise<EntryScope> {
  if (i.productId || i.teamId)
    return { productId: i.productId, teamId: i.teamId };
  if (i.workItemId) {
    const [wi] =
      await sql`select product_id, team_id from work_items where id = ${i.workItemId}`;
    if (wi) return { productId: wi.product_id, teamId: wi.team_id };
  }
  return {};
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadContextSources(input: {
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

tool(
  "fetch_work_item",
  {
    description:
      "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis. Read the messages chronologically. linked_items holds the Azure DevOps items this ticket references, already fetched — they usually carry the engineering side of the story, so treat them as part of the ticket; never re-fetch them and never fetch relations of relations. component is the area→component match when the project has a rule for it. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
    },
  },
  async ({ source, external_id }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({
      workItemId: item.id,
      userId: await resolveCurrentUserId(),
      mode: "ingest",
    });
    const customerName = await getCustomerName(item.customerId);

    const forLlm = resolveRedactionPolicy(conn.config).enabled
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    return out({
      work_item_id: item.id,
      source_project_id: item.sourceProjectId,
      product_id: item.productId,
      team_id: item.teamId,
      customer_id: item.customerId,
      customer_name: customerName,
      ...unresolvedCustomer(item.customerId, item.customerAmbiguity),
      ...(await unresolvedUnit(
        item.customerId,
        item.customerUnitId,
        `${raw.title ?? ""} ${raw.messages
          .map((m) => m.bodyText ?? "")
          .join(" ")
          .slice(0, 4000)}`,
      )),
      ...(await withCustomerProfile(item.customerId)),
      observed_version: item.observedVersion,
      ...(item.componentSlug ? { component: item.componentSlug } : {}),
      ...withCompaction(forLlm),
      ...(await withLinkedAdoItems(raw, item.id)),
    });
  },
);

tool(
  "compact_work_item",
  {
    description:
      "Compact a long ticket into a de-duplicated, attributed turn list ('X: ...' script) and post it back as a private note. Deterministic text processing, no summarising: it strips quoted reply chains, signatures, legal footers, security banners and automated reminders, drops repeated blocks, and recovers content that only ever existed inside a quote (attributed to its real sender and date). post_note (default true) writes the transcript to the ticket where it is readable in full; the reply here is only the stats, because a whole transcript does not belong in the conversation. Ask for return_turns only when you must reason over the text itself — it is truncated to fit, so the note remains the complete copy.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      post_note: z.boolean().optional(),
      replace_previous: z.boolean().optional(),
      return_turns: z.boolean().optional(),
      keep_automated: z.boolean().optional(),
    },
  },
  async ({
    source,
    external_id,
    post_note,
    replace_previous,
    return_turns,
    keep_automated,
  }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    const opts = { keepAutomated: keep_automated === true };
    const full = compactWorkItem(raw, opts);

    let posted: { notes: number; replaced_previous?: number } | undefined;
    let postFailed: string | undefined;
    if (post_note !== false) {
      if (!src.postNote)
        postFailed = `Source '${source}' does not support notes`;
      else {
        await requireCanEdit(await externalWorkItemScope(conn.id, external_id));
        const bodies = splitNoteBody(renderCompactHtml(full));
        for (const body of bodies)
          await src.postNote(external_id, body, { private: true });
        posted = { notes: bodies.length };
        // Only once the replacement is safely on the ticket, and only for notes
        // this tool wrote and can still identify by its own marker.
        if (replace_previous !== false && src.deleteNote) {
          let replaced = 0;
          for (const id of full.prior_transcript_ids)
            await src.deleteNote(id).then(
              () => replaced++,
              () => {},
            );
          if (replaced) posted.replaced_previous = replaced;
        }
      }
    }

    const forLlm = resolveRedactionPolicy(conn.config).enabled
      ? compactWorkItem(
          redactForLlm(
            raw,
            src.redactRaw,
            await getCustomerSlug(item.customerId),
          ),
          opts,
        )
      : full;

    const { turns, ...summary } = forLlm;
    return out({
      work_item_id: item.id,
      ...summary,
      ...(return_turns === true ? capTurns(turns) : {}),
      ...(posted
        ? {
            posted_private_note: posted,
            next: "The full transcript is on the ticket as a private note. Report the stats briefly; do not restate the transcript.",
          }
        : {}),
      ...(postFailed ? { note_not_posted: postFailed } : {}),
    });
  },
);

tool(
  "search_knowledge",
  {
    description: `Search prior knowledge entries by keyword / symptom / error code. Use for consult mode. Results may include status 'deprecated' entries (possibly with superseded_by pointing at their replacement) — warn that those are outdated, never present them as current advice. Filter with product_slug / team_slug (slugs or aliases — not UUIDs), tags (entry must carry at least one), and/or component (matches the entry's linked component or its slug/aliases in tags). ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      component: z.string().optional(),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug from list_customers. Ranks that customer's own material first WITHOUT hiding the rest — a fix found on one install is often the answer for the next.",
        ),
      cloud: cloudSchema
        .optional()
        .describe(
          "Environment slug filter, e.g. prod — see list_environments.",
        ),
      affected_version: z.string().optional(),
      fixed_version: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    query,
    product_slug,
    team_slug,
    tags,
    component,
    customer,
    cloud,
    affected_version,
    fixed_version,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    const rows = await searchKnowledge(query, {
      productId,
      teamId,
      includeUnscoped: true,
      ...(await componentIntoFilter(productId, component, tags)),
      boostCustomerId: customer
        ? await getCustomerIdBySlug(customer)
        : undefined,
      cloud,
      affectedVersion: affected_version,
      fixedVersion: fixed_version,
      limit,
    });
    return searchOut(rows, "search_knowledge");
  },
);

tool(
  "get_context",
  {
    description:
      "Fetch a work item AND auto-search the archive for similar prior cases in one call — the consult-mode entry point. Returns 'similar' (past knowledge entries with their full structured context) and 'reference' (matching project reference docs), each graded; check every similar entry's status, because a 'deprecated' one is outdated and must be flagged as such rather than presented as current advice. 'linked_items' holds the referenced Azure DevOps items, already fetched — read them, never re-fetch. 'project_context' names the ticket's project, its wiki and its repos with the component each implements: use it to aim search_code at the right repo instead of searching everything. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      limit: z.number().int().positive().max(100).optional(),
    },
  },
  async ({ source, external_id, limit }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({
      workItemId: item.id,
      userId: await resolveCurrentUserId(),
      mode: "consult",
    });

    // The embedding window is 512 tokens; a whole first message overruns it and
    // the tail is dropped silently. The lead carries the symptom anyway.
    const firstIncoming = (
      raw.messages.find((m) => m.direction === "incoming")?.bodyText ?? ""
    ).slice(0, 1000);
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const productId = item.productId ?? undefined;
    // One embedding, two searches — the same string was being embedded twice.
    const queryVector = query.trim()
      ? await embedQueryLiteral(query)
      : undefined;
    // The ticket's own customer lifts their history without excluding anyone
    // else's — the same tiebreaker search_knowledge gives an explicit `customer`.
    const boostCustomerId = item.customerId ?? undefined;
    const boostUnitId = item.customerUnitId ?? undefined;
    const [similar, reference] = await Promise.all([
      searchKnowledge(query, {
        productId,
        limit,
        includeUnscoped: true,
        queryVector,
        boostCustomerId,
        boostUnitId,
      }),
      searchReferenceDocs(query, {
        productId,
        limit,
        includeUnscoped: true,
        queryVector,
        boostCustomerId,
      }),
    ]);
    const customerName = await getCustomerName(item.customerId);

    const redact = resolveRedactionPolicy(conn.config).enabled;
    const forLlm = redact
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    const retrievalMap = new TokenMap();
    const { item: workItem, ...compaction } = withCompaction(forLlm);
    const context = await resolveProjectContext({ workItemId: item.id });
    return out({
      work_item: workItem,
      ...compaction,
      similar: redact
        ? scrubDeep(forAgent(similar), retrievalMap)
        : forAgent(similar),
      reference: redact
        ? scrubDeep(forAgent(reference), retrievalMap)
        : forAgent(reference),
      ...(similar.length || reference.length
        ? {}
        : { retrieval_note: NO_MATCHES }),
      customer_id: item.customerId,
      customer_name: customerName,
      ...unresolvedCustomer(item.customerId, item.customerAmbiguity),
      ...(await unresolvedUnit(
        item.customerId,
        item.customerUnitId,
        `${raw.title ?? ""} ${raw.messages
          .map((m) => m.bodyText ?? "")
          .join(" ")
          .slice(0, 4000)}`,
      )),
      ...(await withCustomerProfile(item.customerId)),
      observed_version: item.observedVersion,
      ...(item.componentSlug ? { component: item.componentSlug } : {}),
      ...(context.length ? { project_context: context } : {}),
      ...(await withLinkedAdoItems(raw, item.id)),
    });
  },
);

tool(
  "save_knowledge_entry",
  {
    description:
      "Persist a structured knowledge entry. The call is gated by a review box the user can edit before it runs, so draft it and call — do not ask for approval in prose first. resolution_pattern must be an existing slug from list_resolution_patterns (or omitted) — it is not free text. component must be an existing slug/alias from list_components; if the ticket's area is missing from the glossary, call add_component first — it gets its own review box — then save. product_area is derived automatically from the component hierarchy — it is not an input. For manual entries (no work_item_id) that set component, pass product_slug — component slugs resolve within a product.",
    inputSchema: {
      work_item_id: z.string().optional(),
      product_slug: z
        .string()
        .optional()
        .describe(
          "Product slug or alias — the normal way to scope an entry. Required for manual entries that set component.",
        ),
      team_slug: z.string().optional().describe("Team slug or alias."),
      product_id: z
        .string()
        .optional()
        .describe(
          "Product UUID — only if you already hold one (e.g. from fetch_work_item); otherwise use product_slug.",
        ),
      team_id: z
        .string()
        .optional()
        .describe("Team UUID — otherwise use team_slug."),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Set ONLY when the lesson is true of one customer's install and not of the product — their addon, their configuration, their version. It is not inherited from the ticket, and whose ticket it was is not the test: most problems found on a customer's ticket are the product's behaviour and must stay general, or they will not be found for anyone else. Setting it makes every future answer cite the entry as that customer's case.",
        ),
      unit: z
        .string()
        .optional()
        .describe(
          "Which part of that customer's estate it was learned on — a unit slug from list_customer_units. Needs customer_slug. When the entry comes from a ticket already filed against a unit AND you name that same customer, it is inherited automatically, so pass this only to override.",
        ),
      status: knowledgeStatusSchema.optional(),
      issue_summary: z
        .string()
        .optional()
        .describe(
          "One-paragraph summary of the problem, with error codes and key symptoms inline.",
        ),
      symptoms: z
        .array(z.string())
        .optional()
        .describe(
          "Observable behaviours, as short phrases rather than sentences. Facts, not interpretations: 'Error 023 in logs' yes, 'possible template issue' no.",
        ),
      signals: z
        .array(z.string())
        .optional()
        .describe(
          "Raw searchable identifiers exactly as they appear — error codes, log patterns, status codes: ['023 TOO_MANY_STRINGS', 'ECONNREFUSED', 'HTTP 503']. Trigram-indexed, so a future search for '023' matches.",
        ),
      root_cause: z
        .string()
        .optional()
        .describe(
          "The underlying technical cause, stated precisely. Omit rather than guess — an unknown cause means confidence 'low'.",
        ),
      resolution: z
        .string()
        .optional()
        .describe("What was done, or should be done, to fix it."),
      resolution_pattern: z
        .string()
        .optional()
        .describe(
          "Slug from list_resolution_patterns — a controlled vocabulary, never free text. Omit entirely if none fits.",
        ),
      component: z
        .string()
        .optional()
        .describe(
          "Slug or alias from list_components. Unknown values are rejected with nearest-match suggestions.",
        ),
      confidence: confidenceSchema
        .optional()
        .describe(
          "How sure you are that the root_cause and resolution written here are CORRECT — a property of this entry, not of the ticket. 'high': cause identified and the fix confirmed to address it. 'medium': plausible cause, fix worked but was never confirmed to be the reason. 'low': cause unknown or guessed. No root_cause means 'low'.",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Free-form labels for filtering. Call list_labels first and reuse a slug rather than inventing a near-duplicate; a component slug used as a tag makes the entry findable by component.",
        ),
      cloud: cloudSchema
        .optional()
        .describe(
          "Environment the issue was observed in — lowercase slug (e.g. prod, qa, dev). Call list_environments first and reuse an existing value when one fits.",
        ),
      resolution_clarity: resolutionClaritySchema
        .optional()
        .describe(
          "Whether the ticket actually ended in a fix — a property of what happened, not of how sure you are. 'clear': a specific fix was applied and the issue confirmed gone. 'partial': mitigated or worked around, the underlying cause still stands. 'unclear': closed with no real resolution — it stopped recurring, the customer went quiet, nobody identified a fix. Independent of confidence: a restart that verifiably fixed it with no known cause is clear + low; a cause you fully understand that was never fixed is unclear + high.",
        ),
      hidden_fix: z
        .boolean()
        .optional()
        .describe(
          "True when the real fix was not visible on the ticket surface — the reporter's described problem and the actual cause diverged. Marks the entries worth reading before trusting a ticket at face value, and is filterable in the library.",
        ),
      affected_version: z
        .string()
        .optional()
        .describe(
          "Product version the issue was observed in. When omitted, seeds automatically from the work item's observed_version.",
        ),
      fixed_version: z
        .string()
        .optional()
        .describe(
          "Product version the fix landed in  only when actually known.",
        ),
      structured: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Narrative context — stored and returned wholesale, never filtered on. Include only the keys that apply; don't force empty objects. Known shape: environment {machine, line, component}, key_signals {error_description, context}, investigation_steps [], conversation_summary, technical_analysis {what_happened, why, system_behavior}, constraints_and_rules [], related_configuration [], related_links [] (full URLs). Extra keys are kept.",
        ),
    },
  },
  async (a) => {
    const resolved = await resolveScopeIds(a);
    const productId = a.product_id ?? resolved.productId;
    const teamId = a.team_id ?? resolved.teamId;
    await requireCanEdit(
      await newEntryScope({ productId, teamId, workItemId: a.work_item_id }),
    );
    const row = await saveKnowledgeEntry({
      workItemId: a.work_item_id,
      productId,
      teamId,
      customerSlug: a.customer_slug,
      unit: a.unit,
      createdById: await resolveCurrentUserId(),
      actor: await mcpActor(),
      status: a.status ?? "approved",
      issueSummary: a.issue_summary,
      symptoms: a.symptoms,
      signals: a.signals,
      rootCause: a.root_cause,
      resolution: a.resolution,
      resolutionPattern: a.resolution_pattern,
      component: a.component,
      confidence: a.confidence,
      tags: a.tags,
      cloud: a.cloud,
      resolutionClarity: a.resolution_clarity,
      hiddenFix: a.hidden_fix,
      affectedVersion: a.affected_version,
      fixedVersion: a.fixed_version,
      structured: a.structured,
    });
    return out({ saved: true, id: row.id, status: row.status });
  },
);

tool(
  "post_private_note",
  {
    description:
      "Write a private note back to the source work item (e.g. a Freshdesk private note) with the learned analysis.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      body: z.string(),
    },
  },
  async ({ source, external_id, body }) => {
    const { conn, source: src } = await resolveSource(source);
    if (!src.postNote)
      throw badInput(`Source '${source}' does not support notes`);
    await requireCanEdit(await externalWorkItemScope(conn.id, external_id));
    await src.postNote(external_id, body, { private: true });
    return out({ posted: true, private: true, external_id, body });
  },
);

tool(
  "add_knowledge_feedback",
  {
    description:
      "Record human feedback (a correction, rating, or note) on an existing knowledge entry, so it can be improved over time. kind 'deprecation' records WHY an entry is outdated — the actual retirement is a separate update_knowledge_entry call with status 'deprecated'.",
    inputSchema: {
      knowledge_entry_id: z.string(),
      kind: feedbackKindSchema.optional(),
      rating: z.number().int().min(1).max(5).optional(),
      comment: z.string().optional(),
      patch: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    await requireCanEdit(await knowledgeEntryScope(a.knowledge_entry_id));
    const row = await addFeedback({
      knowledgeEntryId: a.knowledge_entry_id,
      userId: await resolveCurrentUserId(),
      kind: a.kind,
      rating: a.rating,
      comment: a.comment,
      patch: a.patch,
    });
    return out({ added: true, id: row.id, kind: row.kind });
  },
);

tool(
  "record_analysis_run",
  {
    description:
      "Report token usage for an ingest/consult analysis run, for audit and cost accounting. Pass the input/output tokens you used.",
    inputSchema: {
      mode: runModeSchema,
      work_item_id: z.string().optional(),
      model: z.string().optional(),
      input_tokens: z.number().int().optional(),
      output_tokens: z.number().int().optional(),
      meta: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    const row = await recordRun({
      mode: a.mode,
      workItemId: a.work_item_id,
      userId: await resolveCurrentUserId(),
      model: a.model,
      inputTokens: a.input_tokens,
      outputTokens: a.output_tokens,
      meta: a.meta,
    });
    return out({ recorded: true, id: row.id });
  },
);

tool(
  "list_resolution_patterns",
  {
    description:
      "List the controlled vocabulary of resolution patterns. ALWAYS call this before choosing resolution_pattern for save_knowledge_entry — pick an existing slug, or leave it unset, rather than inventing one.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listResolutionPatterns()),
);

tool(
  "list_environments",
  {
    description:
      "List the environments ('cloud' values) already used by knowledge entries in this deployment, with usage counts. The vocabulary is deployment-specific (e.g. prod/qa vs dev/demo/preprod) — call this before setting `cloud` on a save/update and reuse an existing slug when one fits, rather than inventing a near-duplicate.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listEnvironments()),
);

tool(
  "add_resolution_pattern",
  {
    description:
      "Add a new resolution_pattern slug to the controlled vocabulary. Call ONLY when the user explicitly asks to add a new pattern — never invent one just to tag a ticket; leave resolution_pattern unset instead.",
    inputSchema: { slug: z.string(), description: z.string() },
  },
  async ({ slug, description }) => {
    await requireAnyTeamAdmin();
    return out(await addResolutionPattern(slug, description));
  },
);

tool(
  "list_components",
  {
    description:
      "List the architecture glossary (components, hierarchical) for a product. Call this before reasoning about a ticket, so unfamiliar service/component names get checked against the real architecture instead of guessed at.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) =>
    out(await listComponents(await getProductIdBySlug(product_slug))),
);

tool(
  "add_component",
  {
    description:
      "Add (or update) a fact in the architecture glossary, e.g. a service, module, or config pool. Call it whenever a component is genuinely missing — when the user describes the architecture, or when a ticket names an area absent from the list. The review box is where the user refuses one they don't want, so never work around a missing component by inventing a slug inline or forcing the entry onto an unrelated one. Use aliases for alternate names (e.g. slug 'line-controller' with aliases ['lc','LC']) so naming variants resolve to one component.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string(),
      name: z.string(),
      parent_slug: z.string().optional(),
      description: z.string().optional(),
      aliases: z.array(z.string()).optional(),
    },
  },
  async (a) => {
    const productId = await getProductIdBySlug(a.product_slug);
    await requireCanEdit({ productId });
    return out(
      await addComponent({
        productId,
        slug: a.slug,
        name: a.name,
        parentSlug: a.parent_slug,
        description: a.description,
        aliases: a.aliases,
      }),
    );
  },
);

tool(
  "list_customers",
  {
    description:
      "List known customers with their aliases (other NAMES the account trades under) and email_domains (sender domains that resolve to it, including a partner or distributor who raises tickets on their behalf). Use to check before correcting a work item's customer.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listCustomers()),
);

tool(
  "add_customer",
  {
    description:
      "Add (or extend) a customer. Call when the user describes a customer, asks to add one, or a ticket names one that is unresolved but unambiguous; the review box is their chance to refuse it.",
    inputSchema: {
      name: z.string(),
      slug: z.string(),
      aliases: z
        .array(z.string())
        .optional()
        .describe(
          "Other NAMES this account trades under. Not email domains — a domain here would come back out of list_customers as something to call them.",
        ),
      email_domains: z
        .array(z.string())
        .optional()
        .describe(
          "Sender domains that mean this customer, including a partner or distributor who raises tickets for them (arvato.com on Davidoff, tabacaleracigar.com on Logista). A domain listed on two customers deliberately resolves to neither, so give a shared integrator's domain to nobody.",
        ),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    await requireAnyTeamAdmin();
    return out(
      await addCustomer({
        name: a.name,
        slug: a.slug,
        aliases: a.aliases,
        emailDomains: a.email_domains,
        notes: a.notes,
      }),
    );
  },
);

tool(
  "get_customer_profile",
  {
    description:
      "Everything configured about one customer's install: their specifics (the version they run, their layout, integrations), the components they have, their own repos, any source project that exists for them, and the parts their estate divides into (`units` — sites, production lines, tenants). Call it before advising a named customer — a general answer can be wrong for them because of what is here. Pass `unit` when the question is about one part of their estate: the facts then come back RESOLVED for that unit, each carrying `origin` and `inherited`, so you can say a thing is true of every line on a shared layout rather than only of the one asked about. Arrives automatically on fetch_work_item/get_context when the ticket resolves to a customer, so do not re-fetch it then.",
    inputSchema: {
      customer: z.string().describe("Slug from list_customers"),
      unit: z
        .string()
        .optional()
        .describe(
          "Unit slug or alias from list_customer_units. Resolves facts for that part of their estate instead of listing the customer's flat set.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ customer, unit }) =>
    out(await getCustomerProfile(await getCustomerIdBySlug(customer), unit)),
);

tool(
  "list_customer_units",
  {
    description:
      "The parts one customer's estate divides into — sites, production lines, tenants — with how they nest and which shared profile each conforms to. `kind` is a deployment-specific vocabulary, not a fixed list. Read this before set_customer_fact with a unit, or before answering a question about a named line or site: a fact recorded against a line is not visible on the customer as a whole.",
    inputSchema: { customer: z.string().describe("Slug from list_customers") },
    annotations: { readOnlyHint: true },
  },
  async ({ customer }) => {
    const units = await listCustomerUnits(await getCustomerIdBySlug(customer));
    if (!units.length)
      return out({
        units: [],
        note: "This customer's estate is not broken down into units, so every fact about them is customer-wide.",
      });
    const bySlug = new Map(units.map((u) => [u.id, u.slug]));
    return out({
      units: units.map((u) => ({
        slug: u.slug,
        name: u.name,
        kind: u.kind,
        parent: u.parent_id ? (bySlug.get(u.parent_id) ?? null) : null,
        profile: u.profile_id ? (bySlug.get(u.profile_id) ?? null) : null,
        aliases: u.aliases,
        notes: u.notes,
      })),
    });
  },
);

tool(
  "add_customer_unit",
  {
    description:
      "Add (or update) one part of a customer's estate. `parent` is containment — a line is inside a site. `profile` is sharing WITHOUT containment: the shared layout several lines conform to, whose facts they inherit without being part of it. Pick `kind` to match what this deployment already uses (see list_customer_units); it is free text, not a fixed vocabulary. Do not invent units from ticket text — propose one and let the user confirm.",
    inputSchema: {
      customer: z.string().describe("Slug from list_customers"),
      slug: z.string().describe("Short identifier, e.g. 'tlc191'"),
      name: z.string(),
      kind: z
        .string()
        .describe("What sort of part this is, e.g. site, line, layout, tenant"),
      parent: z
        .string()
        .optional()
        .describe("The unit that CONTAINS this one."),
      profile: z
        .string()
        .optional()
        .describe(
          "A unit whose facts this one inherits without being inside it — a shared layout or template.",
        ),
      aliases: z
        .array(z.string())
        .optional()
        .describe("Other names the site calls it by."),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    await requireAnyTeamAdmin();
    return out(
      await addCustomerUnit({
        customerSlug: a.customer,
        slug: a.slug,
        name: a.name,
        kind: a.kind,
        parentSlug: a.parent,
        profileSlug: a.profile,
        aliases: a.aliases,
        notes: a.notes,
      }),
    );
  },
);

tool(
  "list_customer_fact_kinds",
  {
    description:
      "The kinds of customer specific already recorded in this deployment (version, environment, layout, …), with usage counts. The vocabulary is deployment-specific, so call this before set_customer_fact and reuse an existing kind rather than coining a near-duplicate.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listCustomerFactKinds()),
);

tool(
  "set_customer_fact",
  {
    description:
      "Record one specific about a customer's install — the version they run, their line layout, an integration they depend on. This is where customer-specific truth belongs; a knowledge entry is for a problem and its resolution, so do not use one to store what is really a configuration fact. Re-setting the same (unit, kind, label) replaces the value, so this is how a version gets updated rather than duplicated. Pass `unit` when the fact is true of one part of their estate rather than of the whole account — an IP belongs to a line, a timezone to a site. Call list_customer_fact_kinds first and reuse a kind.",
    inputSchema: {
      customer: z.string().describe("Slug from list_customers"),
      unit: z
        .string()
        .optional()
        .describe(
          "Unit slug/alias when the fact is true of one site or line rather than the whole customer. Omit for a customer-wide fact.",
        ),
      kind: z
        .string()
        .describe("What sort of specific this is, e.g. version, layout"),
      label: z
        .string()
        .optional()
        .describe(
          "What it is about when the kind alone is ambiguous — which product a version belongs to, which line a layout describes. Together with kind it identifies the fact, so reuse it to update rather than add.",
        ),
      value: z.string(),
      notes: z.string().optional(),
      source: z
        .string()
        .optional()
        .describe(
          "Where this was learned — a ticket URL, a wiki page, a person.",
        ),
      product_slug: z.string().optional(),
      component: z
        .string()
        .optional()
        .describe("Pin the fact to one component. Needs product_slug."),
    },
  },
  async (a) => {
    await requireAnyTeamAdmin();
    return out(
      await setCustomerFact({
        customerSlug: a.customer,
        unit: a.unit,
        kind: a.kind,
        label: a.label,
        value: a.value,
        notes: a.notes,
        source: a.source,
        componentSlug: a.component,
        productId: a.product_slug
          ? await getProductIdBySlug(a.product_slug)
          : null,
      }),
    );
  },
);

tool(
  "set_customer_component",
  {
    description:
      "Record that a customer runs a component, or that they no longer do (linked: false). Many-to-many on purpose: a shared component has many customers, one built for a single customer has just that one. Use it to answer 'who else runs this?' before treating a fix as safe for everyone.",
    inputSchema: {
      customer: z.string().describe("Slug from list_customers"),
      product_slug: z.string(),
      component: z.string().describe("Slug or alias from list_components"),
      linked: z.boolean().optional().describe("false removes the link"),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    await requireAnyTeamAdmin();
    const productId = await getProductIdBySlug(a.product_slug);
    return out(
      a.linked === false
        ? await unlinkCustomerComponent(a.customer, productId, a.component)
        : await linkCustomerComponent(
            a.customer,
            productId,
            a.component,
            a.notes,
          ),
    );
  },
);

tool(
  "set_work_item_customer",
  {
    description:
      "Correct (or clear) the customer auto-matched to a work item. Use when the auto-match is wrong or missing, e.g. a ticket routed through a distributor.",
    inputSchema: {
      work_item_id: z.string(),
      unit: z
        .string()
        .optional()
        .describe(
          "Which part of that customer's estate the ticket concerns — a unit slug or alias from list_customer_units. Only meaningful alongside a customer.",
        ),
      customer_slug: z.string().nullable(),
    },
  },
  async ({ work_item_id, customer_slug, unit }) => {
    await requireCanEdit(await workItemScope(work_item_id));
    const customerId = customer_slug
      ? await getCustomerIdBySlug(customer_slug)
      : null;
    await setWorkItemCustomer(work_item_id, customerId, unit);
    return out({
      updated: true,
      work_item_id,
      customer_id: customerId,
      ...(unit ? { unit } : {}),
    });
  },
);

tool(
  "set_observed_version",
  {
    description:
      "Record (or clear) the product version observed/mentioned on a specific ticket. Only set this when a version is actually known from the ticket — leave unset otherwise.",
    inputSchema: { work_item_id: z.string(), version: z.string().nullable() },
  },
  async ({ work_item_id, version }) => {
    await requireCanEdit(await workItemScope(work_item_id));
    await setObservedVersion(work_item_id, version);
    return out({ updated: true, work_item_id, observed_version: version });
  },
);

tool(
  "update_knowledge_entry",
  {
    description:
      "Update fields on an existing knowledge entry, or change its status. Mark outdated knowledge with status 'deprecated' (it stays searchable but flagged; set superseded_by when a newer entry replaces it) — reserve 'archived' for entries that should vanish from search entirely. Pass only the fields you want to change; omitted fields are left as-is. Nullable fields (issue_summary, root_cause, etc.) accept null to clear them. component takes a slug/alias from list_components (product_area is re-derived from it; null clears both). The search results include 'version' — pass it as expected_version to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      status: knowledgeStatusSchema.optional(),
      issue_summary: z.string().nullable().optional(),
      root_cause: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
      resolution_pattern: z.string().nullable().optional(),
      symptoms: z.array(z.string()).optional(),
      signals: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      component: z.string().nullable().optional(),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Re-file whose install this was learned on; null makes the lesson general again.",
        ),
      superseded_by: z.string().nullable().optional(),
      confidence: confidenceSchema.nullable().optional(),
      cloud: cloudSchema
        .nullable()
        .optional()
        .describe(
          "Environment slug — reuse an existing value from list_environments when one fits; null clears it.",
        ),
      resolution_clarity: resolutionClaritySchema.nullable().optional(),
      hidden_fix: z.boolean().nullable().optional(),
      affected_version: z
        .string()
        .nullable()
        .optional()
        .describe("Product version the issue was observed in; null clears it."),
      fixed_version: z
        .string()
        .nullable()
        .optional()
        .describe("Product version the fix landed in; null clears it."),
      structured: z.record(z.string(), z.any()).optional(),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    await requireCanEdit(await knowledgeEntryScope(a.id));
    const patch: KnowledgeUpdateInput = {};
    if (a.status !== undefined) patch.status = a.status;
    if (a.issue_summary !== undefined) patch.issueSummary = a.issue_summary;
    if (a.root_cause !== undefined) patch.rootCause = a.root_cause;
    if (a.resolution !== undefined) patch.resolution = a.resolution;
    if (a.resolution_pattern !== undefined)
      patch.resolutionPattern = a.resolution_pattern;
    if (a.symptoms !== undefined) patch.symptoms = a.symptoms;
    if (a.signals !== undefined) patch.signals = a.signals;
    if (a.tags !== undefined) patch.tags = a.tags;
    if (a.component !== undefined) patch.component = a.component;
    if (a.customer_slug !== undefined) patch.customerSlug = a.customer_slug;
    if (a.superseded_by !== undefined) patch.supersededBy = a.superseded_by;
    if (a.confidence !== undefined) patch.confidence = a.confidence;
    if (a.cloud !== undefined) patch.cloud = a.cloud;
    if (a.resolution_clarity !== undefined)
      patch.resolutionClarity = a.resolution_clarity;
    if (a.hidden_fix !== undefined) patch.hiddenFix = a.hidden_fix;
    if (a.affected_version !== undefined)
      patch.affectedVersion = a.affected_version;
    if (a.fixed_version !== undefined) patch.fixedVersion = a.fixed_version;
    if (a.structured !== undefined) patch.structured = a.structured;
    if (a.expected_version !== undefined)
      patch.expectedVersion = a.expected_version;
    const row = await updateKnowledgeEntry(a.id, patch, await mcpActor());
    return out({
      updated: true,
      id: row.id,
      status: row.status,
      version: row.version,
    });
  },
);

tool(
  "get_knowledge_entry",
  {
    description:
      "Fetch a single knowledge entry by id, including its current version and full structured field. Use before update_knowledge_entry / add_knowledge_feedback when you have an id but not the latest version.",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => outScrubbed(await getKnowledgeEntry(id)),
);

tool(
  "list_knowledge_entries",
  {
    description:
      "List knowledge entries (newest first), optionally filtered by status (e.g. 'draft' to find pending entries, 'deprecated' to review outdated ones), product_slug / team_slug (slug or alias), or tags. Useful for review and curation — not semantic search; use search_knowledge for consult.",
    inputSchema: {
      status: knowledgeStatusSchema.optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      component: z
        .string()
        .optional()
        .describe(
          "Component slug/alias  matches the entry's linked component or its slug/aliases in tags. Needs product_slug.",
        ),
      cloud: cloudSchema
        .optional()
        .describe(
          "Environment slug filter, e.g. prod — see list_environments.",
        ),
      affected_version: z.string().optional(),
      fixed_version: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    status,
    product_slug,
    team_slug,
    tags,
    component,
    cloud,
    affected_version,
    fixed_version,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    const rows = await listKnowledgeEntries({
      status,
      productId,
      teamId,
      ...(await componentIntoFilter(productId, component, tags)),
      cloud,
      affectedVersion: affected_version,
      fixedVersion: fixed_version,
      limit,
    });
    return outScrubbed(rows);
  },
);

tool(
  "ingest_context",
  {
    description:
      "Load freeform project context from pasted text, local file paths, and/or URLs, and return the cleaned raw text for you to structure. PDF paths are text-extracted automatically. This tool ONLY reads — it never saves. Long sources are truncated at max_chars (default 20000); for large documents (big PDFs), preview here, then call save_reference_doc with body_path so the full text is extracted and saved server-side. After loading, classify the content and route each part: durable incident lessons → save_knowledge_entry; architecture facts → add_component; everything else (docs, runbooks, design notes, config explainers) → save_reference_doc. Say briefly how you routed it, then make the calls — each is gated by its own review box.",
    inputSchema: {
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      text: z.string().optional(),
      paths: z.array(z.string()).optional(),
      urls: z.array(z.string()).optional(),
      max_chars: z.number().int().positive().optional(),
    },
    // readOnlyHint because nothing here is persisted; openWorldHint because
    // `urls` reaches hosts outside this deployment, which is what a client
    // deciding whether to run this unattended needs to weigh.
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ product_slug, team_slug, text, paths, urls, max_chars }) => {
    const sources = await loadContextSources({ text, paths, urls });
    if (!sources.length)
      throw badInput("Provide at least one of: text, paths, urls");

    const limit = max_chars ?? 20_000;
    const redact = globalRedactionEnabled();
    const map = new TokenMap();
    return out({
      product_slug: product_slug ?? null,
      team_slug: team_slug ?? null,
      sources: sources.map((s) => {
        const truncated = s.text.length > limit;
        const textOut = truncated ? s.text.slice(0, limit) : s.text;
        return {
          source: s.source,
          chars: s.text.length,
          ...(s.pages != null ? { pages: s.pages } : {}),
          truncated,
          text: redact ? scrubText(textOut, map) : textOut,
          ...(truncated
            ? {
                note: `Truncated at ${limit} of ${s.text.length} chars — summarize from this preview; to save the FULL text as a reference doc, call save_reference_doc with body_path.`,
              }
            : {}),
        };
      }),
      ...(redact
        ? {
            redaction:
              "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions — treat them as opaque, never guess the originals.",
          }
        : {}),
      next: "Summarize how this routes, then call save_knowledge_entry / save_reference_doc / add_component. Each call is gated by its own review box.",
    });
  },
);

tool(
  "draft_wiki_page",
  {
    description:
      "Gather everything recorded under one component — knowledge entries and reference docs, including its sub-components — so a wiki article can be composed from them. Returns the substance, not just ids, so you can write from this one call. Use it when asked to write or refresh an article about a part of the product; then compose the article and call save_wiki_article with the ids you actually used in `sources`. Check the wiki's table of contents first (list_wiki_articles) so you extend the structure rather than duplicating a page that exists.",
    inputSchema: {
      product_slug: z.string(),
      component: z
        .string()
        .describe("Component slug; its sub-components are included."),
      limit: z.number().int().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const productId = await getProductIdBySlug(a.product_slug);
    const sources = await draftSources(productId, a.component, a.limit ?? 40);
    if (!sources.length)
      return out({
        sources: [],
        note: `Nothing is recorded under '${a.component}' yet, so there is nothing to consolidate. Say so rather than writing an article from general knowledge.`,
      });
    return outScrubbed({
      sources,
      next: "Compose the article, then call save_wiki_article with `sources` naming the ids you used. It lands as a draft for the user to approve.",
    });
  },
);

tool(
  "list_wiki_articles",
  {
    description:
      "The wiki's table of contents for one product: its categories, nested, with the articles filed under each, plus anything uncategorised. Read this before writing an article, so a new page joins the existing structure instead of duplicating it. Pass product_slug omitted for the org-wide wiki (material that belongs to no single product).",
    inputSchema: { product_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const productId = a.product_slug
      ? await getProductIdBySlug(a.product_slug)
      : null;
    return out(await wikiToc(productId));
  },
);

tool(
  "save_wiki_article",
  {
    description:
      "Write a wiki article — the canonical, browsable answer for a topic, as opposed to a knowledge entry (one incident) or a reference doc (imported material). The body is markdown; use ## headings, which become the article's contents box. Link to other articles with [[slug]], and to a knowledge entry with [[entry:<id>|short label]] — links are extracted on save and become backlinks. Saving with an existing slug UPDATES that article in place, keeping its links and its history. Always pass `sources` with the ids you composed from: that is what lets the page flag itself stale when the material behind it changes. Lands as a draft unless told otherwise; the call is gated by a review box the user can edit.",
    inputSchema: {
      slug: z
        .string()
        .describe(
          "Stable address, kebab-case. Reused on a later save to update the same article rather than making a second one.",
        ),
      title: z.string(),
      body: z
        .string()
        .describe("Markdown. ## headings become the contents box."),
      product_slug: z
        .string()
        .optional()
        .describe("Omit for the org-wide wiki."),
      categories: z
        .array(z.string())
        .optional()
        .describe(
          "Category slugs from list_wiki_articles. An article may sit in several.",
        ),
      component: z.string().optional(),
      sources: z
        .array(
          z.object({
            kind: z.enum(["entry", "doc"]),
            id: z.string(),
          }),
        )
        .optional()
        .describe(
          "What the article was composed from, so staleness can be detected later.",
        ),
      status: referenceStatusSchema.optional(),
      doc_version: z.string().optional(),
    },
  },
  async (a) => {
    const productId = a.product_slug
      ? await getProductIdBySlug(a.product_slug)
      : null;
    await requireCanEdit(productId ? { productId } : {});

    // Only "no such article" takes the create branch. Swallowing every error
    // meant a transient database failure inserted a second row at the same
    // slug, splitting the article's links and its history.
    const existing = await findArticle(productId, a.slug).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") return null;
      throw e;
    });
    const actor = await mcpActor();
    const row = existing
      ? await updateReferenceDoc(
          existing.id as string,
          {
            title: a.title,
            body: a.body,
            status: a.status ?? "draft",
            ...(a.component !== undefined ? { component: a.component } : {}),
            ...(a.doc_version !== undefined
              ? { docVersion: a.doc_version }
              : {}),
          },
          actor,
        )
      : await saveReferenceDoc({
          productId,
          kind: "wiki",
          slug: a.slug,
          title: a.title,
          body: a.body,
          status: a.status ?? "draft",
          component: a.component,
          docVersion: a.doc_version,
          createdById: await resolveCurrentUserId(),
          actor,
        });

    if (a.categories)
      await setArticleCategories(productId, row.id, a.categories);
    if (a.sources?.length)
      await setComposedFrom(
        sql,
        row.id,
        a.sources.map((s) =>
          s.kind === "entry" ? { entryId: s.id } : { docId: s.id },
        ),
      );

    return out({
      saved: true,
      id: row.id,
      slug: a.slug,
      status: row.status,
      updated: !!existing,
      next: `The article is at /library/wiki/${a.product_slug ?? "general"}/${a.slug}. It is a ${row.status}; tell the user where it is rather than pasting it back.`,
    });
  },
);

tool(
  "save_reference_doc",
  {
    description:
      "Persist an APPROVED reference doc — freeform project context (docs, runbooks, architecture notes) that doesn't fit the issue→root_cause→resolution shape of a knowledge entry. The body is chunked and embedded so it surfaces in consult-mode search. Provide EITHER body (inline text) OR body_path (a local file — e.g. a large PDF — extracted server-side so the full text is saved without echoing it). Scope it with product_slug, and add component when the doc is about one part of that product (leave it off for general product docs). Pass doc_version when the source document carries a version label; pass supersedes with the id of the doc this replaces — the predecessor is archived and linked automatically, and search returns only the latest version. The call is gated by a review box the user can edit, so draft it and call rather than asking first.",
    inputSchema: {
      title: z.string(),
      body: z.string().optional(),
      body_path: z.string().optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      component: z.string().optional(),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Set only when the doc describes ONE customer's install (their addon, their configuration). Leave it off for anything true of the product generally — a customer here means the doc is cited as that customer's setup, not as how the product works.",
        ),
      source: z
        .string()
        .optional()
        .describe(
          "Where the content came from — a URL (an ADO wiki page's remote_url), file path or origin note. Provenance, not a connection slug.",
        ),
      tags: z.array(z.string()).optional(),
      status: referenceStatusSchema.optional(),
      structured: z.record(z.string(), z.any()).optional(),
      doc_version: z.string().optional(),
      supersedes: z.string().optional(),
      source_project_id: z
        .string()
        .optional()
        .describe("From get_ado_wiki_page — the project this page belongs to"),
      external_key: z
        .string()
        .optional()
        .describe(
          "The wiki page path. With source_project_id, re-importing the page supersedes the previous revision instead of duplicating it.",
        ),
    },
  },
  async (a) => {
    if (!a.body === !a.body_path)
      throw badInput("Provide exactly one of body or body_path");
    const { productId, teamId } = await resolveScopeIds(a);
    if (productId || teamId || !a.supersedes)
      await requireCanEdit({ productId, teamId });
    else await requireCanEdit(await referenceDocScope(a.supersedes));

    let body = a.body;
    let pages: number | undefined;
    if (a.body_path) {
      const extracted = await extractSource(a.body_path);
      body = globalRedactionEnabled()
        ? scrubText(extracted.text, new TokenMap())
        : extracted.text;
      pages = extracted.pages;
    }
    const row = await saveReferenceDoc({
      title: a.title,
      body: body!,
      productId,
      teamId,
      createdById: await resolveCurrentUserId(),
      actor: await mcpActor(),
      source: a.source,
      sourceProjectId: a.source_project_id,
      externalKey: a.external_key,
      tags: a.tags,
      status: a.status ?? "approved",
      structured: a.structured,
      docVersion: a.doc_version,
      supersedes: a.supersedes,
      component: a.component,
      customerSlug: a.customer_slug,
    });
    return out({
      saved: true,
      id: row.id,
      status: row.status,
      chunks: row.chunks,
      body_chars: body!.length,
      ...(pages != null ? { pages } : {}),
    });
  },
);

tool(
  "search_reference",
  {
    description: `Semantic search over approved reference docs (project context). Returns the best-matching snippet per doc. Only the latest approved version of a doc is returned. Filter by product_slug / team_slug (slug or alias) and tags. ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      component: z.string().optional(),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug from list_customers. Ranks that customer's own material first WITHOUT hiding the rest.",
        ),
      doc_version: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    query,
    product_slug,
    team_slug,
    component,
    customer,
    doc_version,
    tags,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    return searchOut(
      await searchReferenceDocs(query, {
        productId,
        teamId,
        includeUnscoped: true,
        ...(await componentIntoFilter(productId, component, tags)),
        boostCustomerId: customer
          ? await getCustomerIdBySlug(customer)
          : undefined,
        docVersion: doc_version,
        limit,
      }),
      "search_reference",
    );
  },
);

tool(
  "list_reference_docs",
  {
    description:
      "List reference docs (newest first), optionally filtered by status, product_slug / team_slug, component, doc_version or tags. Bodies are omitted; use get_reference_doc for the full text. Rows carry doc_version and superseded_by — archived rows with superseded_by set are old versions of a newer doc.",
    inputSchema: {
      status: referenceStatusSchema.optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      component: z.string().optional(),
      doc_version: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    status,
    product_slug,
    team_slug,
    component,
    doc_version,
    tags,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    return outScrubbed(
      await listReferenceDocs({
        status,
        productId,
        teamId,
        ...(await componentIntoFilter(productId, component, tags)),
        docVersion: doc_version,
        limit,
      }),
    );
  },
);

tool(
  "get_reference_doc",
  {
    description:
      "Fetch a single reference doc by id, including its full body, doc_version, and lineage (all versions of this doc, newest first).",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) =>
    outScrubbed({
      ...(await getReferenceDoc(id)),
      lineage: await referenceDocLineage(id),
    }),
);

tool(
  "update_reference_doc",
  {
    description:
      "Update a reference doc, or change its status ('archived' to retire). Pass only the fields you want to change. If the body changes it is re-chunked and re-embedded. To publish a NEW VERSION of a doc, do not edit the body here — call save_reference_doc with supersedes instead. Pass expected_version (from list/get) to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: referenceStatusSchema.optional(),
      source: z.string().nullable().optional(),
      structured: z.record(z.string(), z.any()).optional(),
      doc_version: z.string().nullable().optional(),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Re-file whose install this documents; null makes it general again.",
        ),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    await requireCanEdit(await referenceDocScope(a.id));
    const patch: ReferenceDocUpdate = {};
    if (a.title !== undefined) patch.title = a.title;
    if (a.body !== undefined) patch.body = a.body;
    if (a.tags !== undefined) patch.tags = a.tags;
    if (a.status !== undefined) patch.status = a.status;
    if (a.source !== undefined) patch.source = a.source;
    if (a.structured !== undefined) patch.structured = a.structured;
    if (a.doc_version !== undefined) patch.docVersion = a.doc_version;
    if (a.customer_slug !== undefined) patch.customerSlug = a.customer_slug;
    if (a.expected_version !== undefined)
      patch.expectedVersion = a.expected_version;
    const row = await updateReferenceDoc(a.id, patch, await mcpActor());
    return out({
      updated: true,
      id: row.id,
      status: row.status,
      version: row.version,
    });
  },
);

tool(
  "list_teams",
  {
    description:
      "List all teams. Call this to discover team slugs before calling add_product, list_products, or search_knowledge with a team filter.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listTeams()),
);

tool(
  "add_team",
  {
    description:
      "Add (or rename) a team. The slug is a short kebab-case identifier used by all other tools.",
    inputSchema: { slug: z.string(), name: z.string() },
  },
  async ({ slug, name }) => {
    await requireGlobalAdmin();
    return out(await addTeam(slug, name));
  },
);

tool(
  "list_products",
  {
    description:
      "List all products, optionally filtered by team slug. Call this to discover product slugs before calling list_components, search_knowledge with a product filter, or add_source_project.",
    inputSchema: { team_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ team_slug }) => out(await listProducts(team_slug)),
);

tool(
  "add_product",
  {
    description:
      "Add (or rename) a product under a team. The slug is used by components, knowledge search, and source mappings. Use aliases for alternate names (e.g. slug 'tpd' with aliases ['Tobacco Product Directive']) so they all resolve to this product.",
    inputSchema: {
      team_slug: z.string(),
      slug: z.string(),
      name: z.string(),
      aliases: z.array(z.string()).optional(),
    },
  },
  async ({ team_slug, slug, name, aliases }) => {
    await requireCanManageTeam(await getTeamIdBySlug(team_slug));
    return out(await addProduct(team_slug, slug, name, aliases));
  },
);

tool(
  "list_labels",
  {
    description:
      "List the optional, per-product advisory tag vocabulary. Call this before tagging a knowledge entry so you reuse existing tag slugs (e.g. 'lc', 'mas', 'printing') instead of inventing near-duplicates. An empty list is normal — tags are free-form, this is just a curated suggestion list.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) =>
    out(await listLabels(await getProductIdBySlug(product_slug))),
);

tool(
  "add_label",
  {
    description:
      "Add a tag slug to a product's advisory label vocabulary. Call when the user wants to curate the team's taxonomy — not inferred silently. Tags on knowledge entries remain free-form; this only records a preferred vocabulary.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string(),
      description: z.string().optional(),
    },
  },
  async ({ product_slug, slug, description }) => {
    const productId = await getProductIdBySlug(product_slug);
    await requireCanEdit({ productId });
    return out(await addLabel(productId, slug, description));
  },
);

tool(
  "list_source_connections",
  {
    description:
      "List all configured source connections (Freshdesk tenants, GitHub orgs, Azure DevOps organizations). Each connection's 'slug' is what every other tool's 'source' parameter takes — call this first whenever you only know the source type.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listSourceConnections()),
);

tool(
  "add_source_connection",
  {
    description:
      'Register a new source connection. source_type is \'freshdesk\', \'github\', or \'azure-devops\'. slug is a short unique identifier (e.g. \'my-freshdesk\') — it also determines the env var for the API token: FRESHDESK_TOKEN_<SLUG_UPPERCASED>, GITHUB_TOKEN_<SLUG_UPPERCASED>, or AZURE_DEVOPS_TOKEN_<SLUG_UPPERCASED> (non-alphanumerics become underscores). For Freshdesk: set base_url to your tenant root URL (e.g. https://your-domain.freshdesk.com). For GitHub: omit base_url and set config to {"repos":["owner/repo"]}. For Azure DevOps: base_url is the org URL (https://dev.azure.com/<org>), config is {"projects":["ProjectA","ProjectB"]}, and the token is a PAT (scopes: Work Items Read, plus Read & Write for ticket creation, Wiki Read for wikis, Code Read for repos). Tokens are never stored in the DB — set the env var, or store per-user/team via the credentials vault.',
    inputSchema: {
      source_type: z.enum(["freshdesk", "github", "azure-devops"]),
      slug: z.string(),
      base_url: z.string().optional(),
      config: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    await requireGlobalAdmin();
    return out(
      await addSourceConnection({
        sourceType: a.source_type,
        slug: a.slug,
        baseUrl: a.base_url,
        config: a.config,
      }),
    );
  },
);

tool(
  "list_source_projects",
  {
    description:
      "List the registered projects of one or all source connections. A project is the source's own grouping — an Azure DevOps project, a Freshdesk group (numeric id as text), a GitHub 'owner/repo'. role 'knowledge' means it maps to a product and can own wikis, repos and area→component rules; role 'tracker' means it is a productless target we only create or reassign work items in.",
    inputSchema: {
      source_slug: z.string().optional(),
      product_slug: z.string().optional(),
      role: z.enum(SOURCE_PROJECT_ROLES).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) =>
    out(
      await listSourceProjects({
        sourceSlug: a.source_slug,
        productId: a.product_slug
          ? await getProductIdBySlug(a.product_slug)
          : undefined,
        role: a.role,
      }),
    ),
);

tool(
  "get_project_context",
  {
    description:
      "Everything configured about a project in one call: its connection and source-native key, the product and team it belongs to, its wikis (`wiki` is the default one, `wikis` lists them all — an ADO project usually has several), its repos with the component each implements and the customer each belongs to (null = shared product code), and its area→component rules. Resolve by product_slug, by work_item_id, or by (source_slug + external_key). Call this before search_code, /ingest-wiki or create_ado_work_item so you use the right repo, wiki and project instead of guessing.",
    inputSchema: {
      product_slug: z.string().optional(),
      work_item_id: z.string().optional(),
      source_slug: z.string().optional(),
      external_key: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) =>
    out(
      await resolveProjectContext({
        productSlug: a.product_slug,
        workItemId: a.work_item_id,
        sourceSlug: a.source_slug,
        externalKey: a.external_key,
      }),
    ),
);

tool(
  "add_source_project",
  {
    description:
      "Register a source-native project. role 'knowledge' binds it to a product (product_slug required) so its items ingest there and it can own a wiki, repos and area rules. role 'tracker' is a productless create/reassign target and needs team_slug instead. For Azure DevOps external_key is the project name (a fetched item's groupKey); for Freshdesk the group_id; for GitHub 'owner/repo'. Call list_source_connections and list_products first.",
    inputSchema: {
      source_slug: z.string(),
      external_key: z.string(),
      name: z.string().optional(),
      role: z.enum(SOURCE_PROJECT_ROLES),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      customer_slug: z
        .string()
        .optional()
        .describe(
          "Set ONLY when the whole project exists for one customer (their own ADO project). Every item ingested from it is then theirs by configuration, which beats guessing at the sender's domain. Leave it off for a product project that serves many customers — a wrong value here mis-files everything in it.",
        ),
      wikis: z
        .array(
          z.object({
            identifier: z.string(),
            name: z.string().optional(),
            type: z.string().optional(),
            root_path: z.string().optional(),
            default: z.boolean().optional(),
          }),
        )
        .optional()
        .describe(
          "The project's wikis, from list_ado_wikis — an ADO project usually has several (one project wiki plus a code wiki per repo). Flag one 'default': that is the one every wiki tool uses when no wiki is named, and the first is taken if you flag none. Knowledge projects only.",
        ),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    if (a.role === "knowledge")
      await requireCanEdit({
        productId: a.product_slug
          ? await getProductIdBySlug(a.product_slug)
          : undefined,
      });
    else
      await requireCanManageTeam(
        a.team_slug ? await getTeamIdBySlug(a.team_slug) : null,
      );
    return out(
      await addSourceProject({
        sourceSlug: a.source_slug,
        externalKey: a.external_key,
        name: a.name,
        role: a.role,
        productSlug: a.product_slug,
        teamSlug: a.team_slug,
        customerSlug: a.customer_slug,
        wikis: a.wikis,
        notes: a.notes,
      }),
    );
  },
);

tool(
  "set_project_area_map",
  {
    description:
      "Map an Azure DevOps area path prefix to a component, so items under that area are filed on that component automatically. The longest matching prefix wins, so a rule on a sub-area beats one on the project root. component must be an existing slug/alias from list_components for the project's product.",
    inputSchema: {
      source_project_id: z.string(),
      area_prefix: z.string(),
      component: z.string(),
    },
  },
  async (a) => {
    await requireCanEdit(await sourceProjectScope(a.source_project_id));
    return out(
      await setProjectAreaMap({
        sourceProjectId: a.source_project_id,
        areaPrefix: a.area_prefix,
        componentSlug: a.component,
      }),
    );
  },
);

async function resolveAdoClient(sourceSlug: string): Promise<{
  conn: Awaited<ReturnType<typeof resolveSource>>["conn"];
  client: AdoClient;
}> {
  const { conn } = await resolveSource(sourceSlug);
  if (conn.sourceType !== "azure-devops")
    throw badInput(
      `Source '${sourceSlug}' is type '${conn.sourceType}' — this tool needs an azure-devops connection (see list_source_connections)`,
    );
  return {
    conn,
    client: createAdoClient({
      baseUrl: conn.baseUrl ?? "",
      slug: conn.slug,
      config: conn.config,
    }),
  };
}

/**
 * Every ADO tool takes either the raw (source, project) pair or a product_slug
 * that resolves to a registered project — with its wiki and defaults attached.
 */
async function resolveAdoTarget(a: {
  source?: string;
  project?: string;
  product_slug?: string;
}): Promise<{
  sourceSlug: string;
  project: string;
  context: Awaited<ReturnType<typeof resolveProjectContextStrict>> | null;
}> {
  if (a.source && a.project && !a.product_slug)
    return { sourceSlug: a.source, project: a.project, context: null };
  const context = await resolveProjectContextStrict({
    productSlug: a.product_slug,
    sourceSlug: a.source,
    externalKey: a.project,
  });
  if (context.connection.source_type !== "azure-devops")
    throw badInput(
      `project '${context.project.external_key}' belongs to a ${context.connection.source_type} connection — this tool needs azure-devops`,
    );
  return {
    sourceSlug: context.connection.slug,
    project: context.project.external_key,
    context,
  };
}

const projectDefaults = (
  context: Awaited<ReturnType<typeof resolveProjectContextStrict>> | null,
  type: string,
): Record<string, unknown> | undefined =>
  (context?.project.config as any)?.defaults?.[type];

/**
 * A wiki argument is matched against the project's registered wikis first, so
 * either the friendly name or the identifier works; anything unrecognised is
 * passed to Azure DevOps as given, which is what makes an unregistered wiki
 * still reachable. With no argument the project's default is used.
 */
function resolveWikiId(
  context: Awaited<ReturnType<typeof resolveProjectContextStrict>> | null,
  wanted: string | undefined,
): string {
  const registered = context?.wikis ?? [];
  if (wanted) return matchWiki(registered, wanted)?.identifier ?? wanted;
  const fallback = context?.wiki?.identifier;
  if (fallback) return fallback;
  throw badInput(
    registered.length
      ? "this project's registered wikis have no default — name one with `wiki`"
      : "no wiki given and this project has none registered — call list_ado_wikis, or set them on the project",
  );
}

/**
 * A wiki URL's last segment is a display slug, not the page path: spaces become
 * dashes, so "/Customer specific (processes)" arrives as
 * "/Customer-specific-(processes)" and the path endpoint 404s on it. When a path
 * misses, the real page tree is consulted and the dashed form matched back.
 */
async function fetchWikiPage(
  client: { getWikiPage: Function; listWikiPages: Function },
  project: string,
  wikiId: string,
  path: string,
): Promise<{ path: string; content: string; remoteUrl?: string }> {
  try {
    return await client.getWikiPage(project, wikiId, path);
  } catch (e) {
    const flat = (s: string) =>
      s
        .replace(/[-\s]+/g, " ")
        .trim()
        .toLowerCase();
    const paths: string[] = await client
      .listWikiPages(project, wikiId)
      .catch(() => []);
    const hit = paths.find((p) => flat(p) === flat(path));
    if (!hit) throw e;
    return client.getWikiPage(project, wikiId, hit);
  }
}

tool(
  "list_ado_wikis",
  {
    description:
      "List the Azure DevOps wikis in a project (or across the org when project is omitted). Pass either source (+ optional project) or product_slug, which resolves to that product's registered project.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const { sourceSlug, project } = a.product_slug
      ? await resolveAdoTarget(a)
      : { sourceSlug: a.source!, project: a.project! };
    const { client } = await resolveAdoClient(sourceSlug);
    const wikis = await client.listWikis(project);
    return out(
      wikis.map((w: any) => ({
        id: w.id,
        name: w.name,
        type: w.type,
        project: w.projectId ?? project ?? null,
      })),
    );
  },
);

tool(
  "list_ado_wiki_pages",
  {
    description:
      "List page paths of an Azure DevOps wiki (flattened page tree). Use get_ado_wiki_page to fetch a page's content. With product_slug, the project and its default wiki are resolved for you — pass wiki only to reach one of its other wikis. A big wiki runs to hundreds of pages, so narrow with path_prefix rather than raising limit.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      wiki: z
        .string()
        .optional()
        .describe(
          "One of the project's registered wikis, by name or identifier (get_project_context lists them), or any wiki name/id from list_ado_wikis. Defaults to the project's default wiki.",
        ),
      path_prefix: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project, product_slug, wiki, path_prefix, limit }) => {
    const target = await resolveAdoTarget({ source, project, product_slug });
    const wikiId = resolveWikiId(target.context, wiki);
    const { client } = await resolveAdoClient(target.sourceSlug);
    let paths = await client.listWikiPages(target.project, wikiId);
    if (path_prefix) paths = paths.filter((p) => p.startsWith(path_prefix));
    const max = limit ?? 100;
    return out({
      wiki: wikiId,
      total: paths.length,
      truncated: paths.length > max,
      pages: paths.slice(0, max),
      ...(paths.length > max
        ? {
            next: "only the first page paths are shown — narrow with path_prefix to see the rest of the tree rather than raising limit.",
          }
        : {}),
    });
  },
);

tool(
  "get_ado_wiki_page",
  {
    description:
      "Fetch one Azure DevOps wiki page's markdown content. READ ONLY — it never saves. To persist the knowledge, classify it (incident lesson → save_knowledge_entry; freeform doc/runbook → save_reference_doc with source set to the page URL, plus the source_project_id and external_key returned here so a re-import supersedes it instead of duplicating). The save call is gated by its own review box.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      wiki: z
        .string()
        .optional()
        .describe(
          "One of the project's registered wikis, by name or identifier; defaults to the project's default wiki",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Page path from list_ado_wiki_pages, e.g. '/Delivery Processes & Tools'. A path copied out of a browser URL has dashes where the real path has spaces; that form is recovered automatically, but page_id is the exact way in.",
        ),
      page_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          "The numeric id in a wiki URL — .../_wiki/wikis/<wiki>/1648/Start means page_id 1648. Use it when the user pasted a link; it needs no path guessing.",
        ),
      max_chars: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project, product_slug, wiki, path, page_id, max_chars }) => {
    if (!path && page_id == null)
      throw badInput("pass either path or page_id (a wiki URL carries the id)");
    const target = await resolveAdoTarget({ source, project, product_slug });
    const wikiId = resolveWikiId(target.context, wiki);
    const { conn, client } = await resolveAdoClient(target.sourceSlug);
    const page =
      page_id != null
        ? await client.getWikiPageById(target.project, wikiId, page_id)
        : await fetchWikiPage(client, target.project, wikiId, path!);
    const limit = max_chars ?? 20_000;
    const truncated = page.content.length > limit;
    const textOut = truncated ? page.content.slice(0, limit) : page.content;
    const redact = resolveRedactionPolicy(conn.config).enabled;
    const map = new TokenMap();
    return out({
      path: page.path,
      remote_url: page.remoteUrl ?? null,
      source_project_id: target.context?.project.id ?? null,
      external_key: page.path,
      product_slug: target.context?.product?.slug ?? null,
      chars: page.content.length,
      truncated,
      content: redact ? scrubText(textOut, map) : textOut,
      ...(redact
        ? {
            redaction:
              "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions — treat them as opaque, never guess the originals.",
          }
        : {}),
      next: "Say where this belongs (reference doc, knowledge entry, or component), then call the matching save — its review box is the approval. Cite remote_url as the doc's source.",
    });
  },
);

tool(
  "get_ado_work_item_schema",
  {
    description:
      "Discover what an Azure DevOps project requires to create a work item. Without type: lists the project's work item types. With type: returns each field's reference name, whether it is required, allowed values, and defaults, plus the defaults configured on the registered project (config.defaults[type]) or on the connection (config.defaults[project][type]). ALWAYS call this before create_ado_work_item — required fields differ per project and type. Pass either source + project, or product_slug.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      type: z.string().optional().describe("Work item type, e.g. 'Bug'"),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const target = await resolveAdoTarget(a);
    const { project } = target;
    const type = a.type;
    const { conn, client } = await resolveAdoClient(target.sourceSlug);
    if (!type) {
      const types = await client.listWorkItemTypes(project);
      return out({
        work_item_types: types.map((t: any) => ({
          name: t.name,
          reference_name: t.referenceName,
          description: t.description ?? null,
        })),
        next: "Call again with type to get its fields.",
      });
    }
    const defaults =
      projectDefaults(target.context, type) ??
      ((conn.config as any)?.defaults?.[project]?.[type] as
        Record<string, unknown> | undefined) ??
      {};
    // Shared with GET /source-connections/:slug/work-item-schema, so what the
    // approval box renders and what the model is told are the same projection.
    return out(await workItemSchema(client, project, type, defaults));
  },
);

tool(
  "create_ado_work_item",
  {
    description:
      "Create a work item (Bug, Task, User Story, ...) in an Azure DevOps project. Call get_ado_work_item_schema FIRST and fill every required field — requirements differ per project/type; never guess. Pass either source + project, or product_slug (or the project's external key) to use a registered project — a 'tracker' project is exactly a create target like this. fields is keyed by ADO reference names (e.g. 'System.AreaPath', 'Microsoft.VSTS.Common.Severity'); the project's configured defaults are applied underneath. description is plain text/HTML — ADO renders System.Description as HTML, markdown will NOT render. Pass work_item_id when raising this from a ticket, so the ticket records what tracks it. The review box shows the full field set for the user to edit, so draft it and call; a denial means they want changes, not a retry. Requires a PAT with Work Items Read & Write.",
    inputSchema: {
      source: sourceSlug.optional(),
      project: z.string().optional(),
      product_slug: z.string().optional(),
      type: z.string(),
      title: z.string(),
      description: z.string().optional(),
      fields: z.record(z.string(), z.any()).optional(),
      parent_id: z.string().optional(),
      related_ids: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      work_item_id: z
        .string()
        .optional()
        .describe("The tachy work item this is raised from, if any"),
    },
  },
  async (a) => {
    const target = await resolveAdoTarget(a);
    const project = target.project;
    const { conn, client } = await resolveAdoClient(target.sourceSlug);
    const defaults =
      projectDefaults(target.context, a.type) ??
      ((conn.config as any)?.defaults?.[project]?.[a.type] as
        Record<string, unknown> | undefined) ??
      {};
    const merged: Record<string, unknown> = {
      ...defaults,
      ...(a.fields ?? {}),
    };
    merged["System.Title"] = a.title;
    if (a.description != null)
      merged["System.Description"] =
        /<\/?(p|div|br|ul|ol|li|b|i|em|strong|a|span|h[1-6]|table|tr|td)\b/i.test(
          a.description,
        )
          ? a.description
          : `<div>${a.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
    if (a.tags?.length) merged["System.Tags"] = a.tags.join("; ");

    const patch: JsonPatchOp[] = Object.entries(merged).map(([k, v]) => ({
      op: "add",
      path: `/fields/${k}`,
      value: v,
    }));
    const relation = (rel: string, id: string): JsonPatchOp => ({
      op: "add",
      path: "/relations/-",
      value: {
        rel,
        url: `${client.orgUrl}/_apis/wit/workItems/${id}`,
      },
    });
    if (a.parent_id)
      patch.push(relation("System.LinkTypes.Hierarchy-Reverse", a.parent_id));
    for (const id of a.related_ids ?? [])
      patch.push(relation("System.LinkTypes.Related", id));

    const created = await client.createWorkItem(project, a.type, patch);
    const userId = await resolveCurrentUserId();
    await recordRun({
      userId,
      mode: "create",
      meta: {
        source: target.sourceSlug,
        project,
        type: a.type,
        ado_id: created.id,
      },
    });
    if (a.work_item_id)
      await addWorkItemLink({
        fromWorkItemId: a.work_item_id,
        toSourceProjectId: target.context?.project.id ?? null,
        toExternalId: String(created.id),
        kind: "tracked_by",
        createdById: userId,
      });
    return out({
      created: true,
      id: created.id,
      ...(a.work_item_id ? { linked_to_work_item: a.work_item_id } : {}),
      url:
        created._links?.html?.href ??
        `${client.orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${created.id}`,
    });
  },
);

tool(
  "list_repos",
  {
    description:
      "List linked git repositories available for code search, with the component each one implements, the customer it belongs to (null = shared product code), and its index freshness. index_status 'error' or a stale last_indexed_at means results may not reflect current code — say so when citing. Filter by product or component to find the repo that actually holds the area you are asking about, or by customer to find their addon.",
    inputSchema: {
      product_slug: z.string().optional(),
      component: z.string().optional(),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug from list_customers. Returns their own addon repos AND the shared ones, because an addon sits on shared product code.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug, component, customer }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    const rows = await listRepos({
      productId,
      componentId:
        productId && component
          ? (await resolveComponentStrict(productId, component)).id
          : undefined,
      customerId: customer ? await getCustomerIdBySlug(customer) : undefined,
    });
    return out(
      rows.map((r) => ({
        slug: r.slug,
        url: r.url,
        product_slug: r.product_slug,
        component: r.component_slug,
        customer: r.customer_slug,
        project_key: r.project_key,
        default_branch: r.default_branch,
        index_status: r.index_status,
        indexed_commit: r.indexed_commit,
        last_indexed_at: r.last_indexed_at,
        file_count: r.file_count,
        chunk_count: r.chunk_count,
        ...(r.index_error ? { index_error: r.index_error } : {}),
      })),
    );
  },
);

tool(
  "search_code",
  {
    description: `Hybrid (semantic + trigram) search over the indexed code of linked repositories. Returns the top-matching chunks with path, line range, and the commit they were indexed at. Search with symptom terms, symbol names, or error strings; then use read_code_file to read narrowly around a hit. Results reflect the indexed commit, not necessarily the latest code — always cite path:start-end @ commit and mention index age when advising. ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      repo: z.string().optional().describe("Repo slug from list_repos"),
      product_slug: z.string().optional(),
      component: z
        .string()
        .optional()
        .describe(
          "Component slug — searches only the repos that implement it. Needs product_slug.",
        ),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug — searches their addon repos AND the shared ones, since an addon sits on shared product code. Another customer's addon is excluded.",
        ),
      path_prefix: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    query,
    repo,
    product_slug,
    component,
    customer,
    path_prefix,
    limit,
  }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    if (component && !productId)
      throw badInput("component needs product_slug to resolve against");
    const rows = await searchCode(query, {
      repoSlug: repo,
      productId,
      componentId:
        productId && component
          ? (await resolveComponentStrict(productId, component)).id
          : undefined,
      customerId: customer ? await getCustomerIdBySlug(customer) : undefined,
      pathPrefix: path_prefix,
      limit,
    });
    await recordRun({
      userId: await resolveCurrentUserId(),
      mode: "code",
      meta: { query, repo: repo ?? null, hits: rows.length },
    });
    return searchOut(
      rows.map((r: any) => ({
        repo: r.repo_slug,
        component: r.component_slug,
        customer: r.customer_slug,
        path: r.path,
        lines: `${r.start_line}-${r.end_line}`,
        lang: r.lang,
        relevance: r.relevance,
        grade: r.grade,
        snippet: r.snippet,
        indexed_commit: r.indexed_commit,
        indexed_days_ago: r.indexed_days_ago,
      })),
      "search_code",
    );
  },
);

tool(
  "read_code_file",
  {
    description:
      "Read a bounded slice of a file from a linked repo at its indexed commit (max 400 lines per call). Use after search_code to see the surrounding context of a hit. Never paste whole files into answers or saved knowledge entries — quote only the relevant lines.",
    inputSchema: {
      repo: z.string(),
      path: z.string(),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, path, start_line, end_line }) => {
    return outScrubbed(
      await readCodeFile(repo, path, {
        startLine: start_line,
        endLine: end_line,
      }),
    );
  },
);

tool(
  "export_table",
  {
    description:
      "Generate a downloadable spreadsheet (xlsx) or CSV from rows you produce, and return a download link. When the user attached an artifact that declares output columns, pass its artifact_slug and fill EXACTLY those columns — extra columns, renamed keys or missing required values are rejected with the reason, so fix the rows and call again. Without an artifact, pass columns yourself. Never print the table into the chat and never restate the rows afterwards: the user gets the file. The result carries only a descriptor (id, filename, size, url), never the file contents.",
    inputSchema: {
      artifact_slug: z
        .string()
        .optional()
        .describe(
          "Slug of an artifact whose spec.output declares the columns and format. Takes precedence over columns.",
        ),
      format: z
        .enum(TABLE_FORMATS)
        .optional()
        .describe("Overrides the artifact's format. Defaults to xlsx."),
      sheet: z.string().optional(),
      filename: z
        .string()
        .optional()
        .describe("Supports {date} and {slug} placeholders."),
      columns: z
        .array(tableColumnSchema)
        .optional()
        .describe("Required when artifact_slug is not given."),
      rows: z
        .array(z.record(z.string(), z.unknown()))
        .describe(
          "One object per row, keyed by column key. Dates as ISO strings and numbers as numbers, so the cells are typed and Excel sorts them properly. Leave an optional column null rather than inventing a value.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ artifact_slug, format, sheet, filename, columns, rows }) => {
    const userId = await resolveCurrentUserId();
    const artifact = artifact_slug
      ? await getArtifactBySlug(artifact_slug, {
          userId: userId ?? undefined,
          teamId: userId
            ? ((await userSoleTeamId(userId)) ?? undefined)
            : undefined,
        })
      : undefined;

    if (artifact_slug && !artifact)
      throw badInput(`no artifact '${artifact_slug}' is visible to you`);

    const output = artifact?.spec?.output;
    const spec = output ?? {
      format: format ?? "xlsx",
      sheet,
      filename,
      columns: columns ?? [],
    };
    if (!spec.columns.length)
      throw badInput(
        "no columns: pass columns, or an artifact_slug whose spec declares them",
      );

    const chosen = format ?? spec.format;
    const rendered = renderTable({
      format: chosen,
      sheet: sheet ?? spec.sheet,
      columns: spec.columns,
      rows,
    });

    const meta = await createOutput({
      userId,
      artifactId: artifact?.id ?? null,
      utility: "export_table",
      filename: outputFilename(
        { filename: filename ?? spec.filename, format: chosen },
        artifact_slug ?? "export",
      ),
      mime: rendered.mime,
      bytes: rendered.bytes,
      meta: { rows: rows.length, columns: spec.columns.length },
    });

    return out({
      output: {
        id: meta.id,
        filename: meta.filename,
        mime: meta.mime,
        byte_size: meta.byte_size,
        rows: rows.length,
        columns: spec.columns.length,
        url: `/api/outputs/${meta.id}/download`,
        expires_at: meta.expires_at,
      },
      next: "The file is ready and the user sees a download card. Say one line about what it contains — do not restate the rows.",
    });
  },
);

export { server };

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await loadSettingsIntoEnv();
  } catch {
    /* keep env-only behavior */
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
