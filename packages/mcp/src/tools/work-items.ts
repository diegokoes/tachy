/**
 * The work item itself: reading it from its source, shrinking a long one, and
 * writing back to it (the private note, whose customer it is, and the version
 * it was seen on).
 */
import { z } from "zod";
import { resolveSource, resolveProjectContext } from "@tachy/core/sources";
import {
  ingestWorkItem,
  compactWorkItem,
  fileLinker,
  renderAnalysisNote,
  renderCompactNotes,
  renderSummaryHtml,
  priorSummaryIds,
  replaceNotes,
  ticketSummarySchema,
  transcriptOnTicket,
  externalWorkItemScope,
  workItemScope,
  type CitedCode,
} from "@tachy/core/work-items";
import { searchKnowledge } from "@tachy/core/knowledge";
import { resolveCurrentUserId, userDisplayName } from "@tachy/core/access";
import { recordRun } from "@tachy/core/analytics";
import {
  getCustomerIdBySlug,
  getCustomerName,
  setWorkItemCustomer,
  setObservedVersion,
} from "@tachy/core/catalog";
import {
  getRepoBySlug,
  readCodeFile,
  repoFileUrl,
  repoToken,
} from "@tachy/core/code";
import {
  globalRedactionEnabled,
  scrubDeep,
  scrubText,
  TokenMap,
} from "@tachy/core/compliance";
import { readForModel } from "@tachy/core/flows";
import { searchReferenceDocs } from "@tachy/core/reference";
import { embedQueryLiteral } from "@tachy/core/search";
import { badInput } from "@tachy/core/infra";
import { tool } from "../server";
import { NO_MATCHES, forAgent, out } from "../results";
import { requireCanEdit } from "../permissions";
import { limitField, MAX_CODE_RANGE_LINES, sourceSlug } from "../fields";
import {
  capTurns,
  withCompaction,
  withFiles,
  withGuidance,
  withLinkedAdoItems,
  workItemFacts,
} from "../context";

/** How much of the first incoming message goes into the search query. */
const QUERY_LEAD_CHARS = 1000;

const MAX_CITED_CODE = 5;

/** The person this chat runs for, as a note names them. */
async function requesterName(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  return userId ? userDisplayName(userId) : null;
}

const askedInChat = (name: string | null) =>
  name ? `${name} in chat` : undefined;

tool(
  "fetch_work_item",
  {
    description:
      "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis. Read the messages chronologically. linked_items holds the Azure DevOps items this ticket references, already fetched - they usually carry the engineering side of the story, so treat them as part of the ticket; never re-fetch them and never fetch relations of relations. component is the area→component match when the project has a rule for it. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
    },
  },
  async ({ source, external_id }) => {
    const resolved = await resolveSource(source);
    const { conn, source: src } = resolved;
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({
      workItemId: item.id,
      userId: await resolveCurrentUserId(),
      mode: "ingest",
    });
    const view = await readForModel(resolved, raw, {
      customerId: item.customerId,
    });
    return out({
      work_item_id: item.id,
      source_project_id: item.sourceProjectId,
      product_id: item.productId,
      team_id: item.teamId,
      ...(await workItemFacts(item, view.kept)),
      ...withGuidance(view),
      ...withCompaction(view.item),
      ...withFiles(view.item, conn.slug, src),
      ...(await withLinkedAdoItems(view.kept, item.id)),
    });
  },
);

tool(
  "compact_work_item",
  {
    description:
      "Compact a long ticket into a de-duplicated, attributed turn list ('X: ...' script) and post it back as a private note. Deterministic text processing, no summarising: it strips quoted reply chains, signatures, legal footers, security banners and automated reminders, drops repeated blocks, and recovers content that only ever existed inside a quote (attributed to its real sender and date). post_note (default true) writes the transcript to the ticket where it is readable in full; the reply here is only the stats, because a whole transcript does not belong in the conversation. Ask for return_turns only when you must reason over the text itself - it is truncated to fit, so the note remains the complete copy.",
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
    const resolved = await resolveSource(source);
    const { conn, source: src } = resolved;
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    const view = await readForModel(resolved, raw, {
      customerId: item.customerId,
    });
    const opts = { keepAutomated: keep_automated === true };
    const full = compactWorkItem(view.kept, opts);

    let posted: { notes: number; replaced_previous?: number } | undefined;
    let postFailed: string | undefined;
    if (post_note !== false) {
      if (!src.postNote)
        postFailed = `Source '${source}' does not support notes`;
      else {
        await requireCanEdit(await externalWorkItemScope(conn.id, external_id));
        // Only notes this tool wrote, identified by its own marker, are replaced.
        posted = await replaceNotes(
          src,
          external_id,
          renderCompactNotes(full, {
            requestedBy: askedInChat(await requesterName()),
          }),
          replace_previous !== false ? full.prior_transcript_ids : [],
        );
      }
    }

    const forLlm = view.redacted ? compactWorkItem(view.item, opts) : full;

    const { turns, ...summary } = forLlm;
    return out({
      work_item_id: item.id,
      ...summary,
      ...withFiles(view.item, conn.slug, src),
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
  "get_context",
  {
    description:
      "Fetch a work item AND auto-search the archive for similar prior cases in one call - the consult-mode entry point. Returns 'similar' (past knowledge entries with their full structured context) and 'reference' (matching project reference docs), each graded; check every similar entry's status, because a 'deprecated' one is outdated and must be flagged as such rather than presented as current advice. 'linked_items' holds the referenced Azure DevOps items, already fetched - read them, never re-fetch. 'project_context' names the ticket's project, its wiki and its repos with the component each implements: use it to aim search_code at the right repo instead of searching everything. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      limit: limitField,
    },
  },
  async ({ source, external_id, limit }) => {
    const resolved = await resolveSource(source);
    const { conn, source: src } = resolved;
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({
      workItemId: item.id,
      userId: await resolveCurrentUserId(),
      mode: "consult",
    });
    const view = await readForModel(resolved, raw, {
      customerId: item.customerId,
    });

    // A whole first message overruns the embedding window, which drops the
    // tail. The lead carries the symptom.
    const firstIncoming = (
      view.kept.messages.find((m) => m.direction === "incoming")?.bodyText ?? ""
    ).slice(0, QUERY_LEAD_CHARS);
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const productId = item.productId ?? undefined;
    // Embedded once for both searches.
    const queryVector = query.trim()
      ? await embedQueryLiteral(query)
      : undefined;
    // The ticket's own customer lifts their history without excluding anyone
    // else's: the tiebreaker search_knowledge gives an explicit `customer`.
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
    const retrievalMap = new TokenMap();
    const { item: workItem, ...compaction } = withCompaction(view.item);
    const context = await resolveProjectContext({ workItemId: item.id });
    return out({
      work_item: workItem,
      ...compaction,
      similar: view.redacted
        ? scrubDeep(forAgent(similar), retrievalMap)
        : forAgent(similar),
      reference: view.redacted
        ? scrubDeep(forAgent(reference), retrievalMap)
        : forAgent(reference),
      ...(similar.length || reference.length
        ? {}
        : { retrieval_note: NO_MATCHES }),
      ...(await workItemFacts(item, view.kept)),
      ...withGuidance(view),
      ...withFiles(view.item, conn.slug, src),
      ...(context.length ? { project_context: context } : {}),
      ...(await withLinkedAdoItems(view.kept, item.id)),
    });
  },
);

tool(
  "post_work_item_summary",
  {
    description:
      "Post a summary of a ticket onto it as a private note, replacing the summary an earlier call posted. Read the whole thread first (fetch_work_item), and open the files that bear on the problem (read_file), then pass the content only, with each file's path so the note can link to it: the note's layout and markup are produced here, so write plain sentences with no markdown or HTML. Summarise what the thread and the files you opened say; where they do not say, leave it out. The note's header, the customer and a pointer to the compacted transcript are added here from the ticket; leave them out of the text.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      ...ticketSummarySchema.shape,
    },
  },
  async ({ source, external_id, ...summary }) => {
    const { conn, source: src } = await resolveSource(source);
    if (!src.postNote)
      throw badInput(`Source '${source}' does not support notes`);
    await requireCanEdit(await externalWorkItemScope(conn.id, external_id));
    const raw = await src.fetchItem(external_id);
    const { customerId } = await ingestWorkItem(conn.id, raw);
    const linkOf = fileLinker(raw, {
      source,
      // Only a source that opens files has something for the link to open.
      origin: src.openAttachment ? process.env.TACHY_PUBLIC_ORIGIN : undefined,
    });
    const note = renderSummaryHtml({ external_id, title: raw.title }, summary, {
      linkOf,
      customer: await getCustomerName(customerId),
      requestedBy: askedInChat(await requesterName()),
      transcript: transcriptOnTicket(raw.messages),
    });
    const posted = await replaceNotes(
      src,
      external_id,
      [note],
      priorSummaryIds(raw.messages),
    );
    return out({
      posted_private_note: posted,
      external_id,
      next: "The summary is on the ticket as a private note. Say so in at most two lines; do not restate it.",
    });
  },
);

const codeRefSchema = z.object({
  repo: z.string().describe("Repo slug from list_repos."),
  path: z.string().describe("The file's path as read_code_file returned it."),
  start_line: z.number().int().positive(),
  end_line: z
    .number()
    .int()
    .positive()
    .describe(
      `With start_line, the range you read with read_code_file, at most ${MAX_CODE_RANGE_LINES} lines.`,
    ),
  version: z
    .string()
    .optional()
    .describe("As read_code_file: the release the range was read at."),
  ref: z
    .string()
    .optional()
    .describe("As read_code_file: the line the range was read on."),
  highlight: z
    .tuple([z.number().int().positive(), z.number().int().positive()])
    .optional()
    .describe(
      "[first, last]: the lines inside the range that decide the outcome, a few at most. The link opens with them selected and the note quotes them. Leave it out to cite the whole range.",
    ),
});

type CodeRef = z.infer<typeof codeRefSchema>;

/** Reads a cited range again at its source, so the link and quote are real. */
async function citedCode(
  ref: CodeRef,
  userId: string | null,
): Promise<CitedCode> {
  if (ref.end_line - ref.start_line >= MAX_CODE_RANGE_LINES)
    throw badInput(
      `${ref.path} spans more than ${MAX_CODE_RANGE_LINES} lines; narrow it`,
    );
  const [startLine, endLine] = ref.highlight ?? [ref.start_line, ref.end_line];
  if (
    startLine > endLine ||
    startLine < ref.start_line ||
    endLine > ref.end_line
  )
    throw badInput(
      `${ref.path}: highlight must sit inside start_line-end_line`,
    );
  const read = await readCodeFile(ref.repo, ref.path, {
    startLine,
    endLine,
    version: ref.version,
    ref: ref.ref,
    token: await repoToken(ref.repo, userId),
  });
  if (read.end_line < read.start_line)
    throw badInput(`${ref.path} has ${read.total_lines} lines`);
  const numbered = read.content.replace(/^(\d+)\t/gm, "$1  ");
  const repo = await getRepoBySlug(ref.repo);
  return {
    repo: ref.repo,
    path: read.path,
    commit: read.commit,
    startLine: read.start_line,
    endLine: read.end_line,
    url: repoFileUrl(repo.url, {
      path: read.path,
      commit: read.commit,
      startLine: read.start_line,
      endLine: read.end_line,
    }),
    excerpt: globalRedactionEnabled()
      ? scrubText(numbered, new TokenMap())
      : numbered,
  };
}

tool(
  "post_private_note",
  {
    description:
      "Post a private note on a ticket: an analysis, a finding, or something the user asked to record there. For a summary of the whole ticket use post_work_item_summary, which replaces the previous one. The note's heading, byline and footer are added here; pass a title and the text, and any code the note rests on in code, cited in the text as [[1]], [[2]] and so on, never as paths or links.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      title: z
        .string()
        .min(1)
        .max(100)
        .describe(
          'The note\'s heading: what it says, in under ten words, e.g. "Why sync drops after a reconnect".',
        ),
      body: z
        .string()
        .describe(
          "Plain text. A blank line starts a paragraph, lines starting '- ' or '1. ' become a list, URLs become links, and <b>, <i> and <code> are kept; any other markup shows as text. Never markdown. Where the note rests on code, explain it for a support colleague who may not read code: what it does in the product's terms and how that produces what the customer sees, naming the function or setting so a developer can find it, and say when the code you read is a different version from the customer's. It lands on the customer's own ticket in their helpdesk - private to your organisation, not to you, and visible to every agent who opens it. Write it as something a colleague will read six months from now.",
        ),
      code: z
        .array(codeRefSchema)
        .max(MAX_CITED_CODE)
        .default([])
        .describe(
          `Code the note rests on: only ranges you read with read_code_file in this conversation, at most ${MAX_CITED_CODE}. Cite each one in body as [[n]], n counting from 1, where the text talks about it. The note turns each citation into a link to the file in its repo at the commit you read, with the cited lines selected, and quotes those lines after that paragraph. Empty when no code was read.`,
        ),
    },
  },
  async ({ source, external_id, title, body, code }) => {
    const { conn, source: src } = await resolveSource(source);
    if (!src.postNote)
      throw badInput(`Source '${source}' does not support notes`);
    await requireCanEdit(await externalWorkItemScope(conn.id, external_id));
    const userId = await resolveCurrentUserId();
    const cited: CitedCode[] = [];
    for (const ref of code) cited.push(await citedCode(ref, userId));
    const name = await requesterName();
    const note = renderAnalysisNote({
      externalId: external_id,
      title,
      body,
      code: cited,
      requestedBy: askedInChat(name),
      caveat: name
        ? `Written by a model in a chat with ${name}.`
        : "Written by a model in a chat.",
    });
    await src.postNote(external_id, note, { private: true });
    return out({
      posted: true,
      private: true,
      external_id,
      cited: cited.map(({ path, startLine, endLine, url }) => ({
        path,
        lines: `${startLine}-${endLine}`,
        linked: url !== null,
      })),
      next: "The note is on the ticket. Say so in one line; do not restate it.",
    });
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
          "Which part of that customer's estate the ticket concerns - a unit slug or alias from list_customer_units. Only meaningful alongside a customer.",
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
      "Record (or clear) the product version observed/mentioned on a specific ticket. Only set this when a version is actually known from the ticket - leave unset otherwise.",
    inputSchema: { work_item_id: z.string(), version: z.string().nullable() },
  },
  async ({ work_item_id, version }) => {
    await requireCanEdit(await workItemScope(work_item_id));
    await setObservedVersion(work_item_id, version);
    return out({ updated: true, work_item_id, observed_version: version });
  },
);
