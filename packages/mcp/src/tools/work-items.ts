/**
 * The work item itself: reading it from its source, shrinking a long one, and
 * writing back to it (the private note, whose customer it is, and the version
 * it was seen on).
 */
import { z } from "zod";
import {
  resolveSource,
  resolveProjectContext,
  type ProjectContext,
} from "@tachy/core/sources";
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
  ticketQueryVectors,
  type CitedCode,
  type RawWorkItem,
} from "@tachy/core/work-items";
import { searchKnowledge, suggestComponent } from "@tachy/core/knowledge";
import { resolveCurrentUserId, userDisplayName } from "@tachy/core/access";
import { recordRun } from "@tachy/core/analytics";
import {
  getComponentSlug,
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
  searchCode,
} from "@tachy/core/code";
import {
  globalRedactionEnabled,
  scrubDeep,
  scrubText,
  TokenMap,
} from "@tachy/core/compliance";
import { readForModel } from "@tachy/core/flows";
import { searchReferenceDocs } from "@tachy/core/reference";
import { exactTerms, queryWindows } from "@tachy/core/search";
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

/** How much of the first incoming message a ticket's opening holds. */
const OPENING_LEAD_CHARS = 1000;

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
      "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis. Read the messages chronologically. linked_items holds the Azure DevOps items this ticket references, already fetched - they usually carry the engineering side of the story, so treat them as part of the ticket; never re-fetch them and never fetch relations of relations. component is the area→component match when the project has a rule for it; with no rule, component_suggestion names the component most of the ticket's similar past entries carry and how many agree - a hint to weigh, not a rule. A long, repetitive ticket comes back as transcript + compaction instead of item.messages. 'code' points at places in the indexed repos of the ticket's project that a first search on the ticket's text found (path, lines, the names defined there): read them with read_code_file, and use search_code for more.",
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
    const repoSlugs = indexedRepoSlugs(
      await resolveProjectContext({ workItemId: item.id }),
    );
    const unmappedProductId = item.componentSlug ? null : item.productId;
    const search =
      repoSlugs.length || unmappedProductId
        ? await ticketSearch(item.id, view.kept)
        : null;
    const [code, suggestion] = search
      ? await Promise.all([
          codePointers(search, repoSlugs),
          componentSuggestion(search, unmappedProductId),
        ])
      : [[], null];
    return out({
      work_item_id: item.id,
      source_project_id: item.sourceProjectId,
      product_id: item.productId,
      team_id: item.teamId,
      ...(await workItemFacts(item, view.kept)),
      ...withGuidance(view),
      ...withCompaction(view.item),
      ...withFiles(view.item, conn.slug, src),
      ...(code.length ? { code } : {}),
      ...(suggestion ? { component_suggestion: suggestion } : {}),
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

/** A ticket's searches, built once and run on several surfaces. */
interface TicketSearch {
  /**
   * The title and the lead of the first incoming message: what the keyword
   * legs read when the ticket quotes no exact term.
   */
  query: string;
  /** One per window of the whole thread. */
  queryVectors: string[];
  exactTerms: string[];
}

/** The title and the lead of the first incoming message, where the symptom is. */
function ticketOpening(item: RawWorkItem): string {
  const firstIncoming = (
    item.messages.find((m) => m.direction === "incoming")?.bodyText ?? ""
  ).slice(0, OPENING_LEAD_CHARS);
  return [item.title, firstIncoming].filter(Boolean).join(" ");
}

/**
 * What a ticket is searched by: the whole thread as the agent reads it, with
 * quoted chains, signatures and auto-replies taken out, so a problem stated in
 * a later message or an internal note is found too. A window embedded at an
 * earlier open of the ticket is not embedded again.
 */
async function ticketSearch(
  workItemId: string,
  item: RawWorkItem,
): Promise<TicketSearch> {
  const [firstTurn = "", ...laterTurns] = compactWorkItem(item).turns.map(
    (turn) => turn.text,
  );
  const messages = [
    [item.title, firstTurn].filter(Boolean).join("\n\n"),
    ...laterTurns,
  ];
  const thread = messages.join("\n\n");
  const windows = queryWindows(messages);
  return {
    query: ticketOpening(item) || (windows[0] ?? ""),
    queryVectors: await ticketQueryVectors(workItemId, windows),
    exactTerms: exactTerms(thread),
  };
}

const indexedRepoSlugs = (context: ProjectContext[]): string[] => [
  ...new Set(
    context.flatMap((project) =>
      project.repos.filter((r) => r.indexed_commit).map((r) => r.slug),
    ),
  ),
];

/** Similar past entries that vote on a ticket's component. */
const COMPONENT_VOTERS = 5;

/**
 * For a ticket no area rule mapped, the component its similar past entries
 * agree on, with how many do. Null when they don't agree, or when the ticket
 * has a component or no product.
 */
async function componentSuggestion(
  search: TicketSearch,
  productId: string | null,
) {
  if (!productId || !search.query.trim()) return null;
  const similar = await searchKnowledge(search.query, {
    productId,
    includeUnscoped: true,
    limit: COMPONENT_VOTERS,
    queryVectors: search.queryVectors,
    exactTerms: search.exactTerms,
  });
  const vote = suggestComponent(similar);
  const component = vote && (await getComponentSlug(vote.componentId));
  if (!vote || !component) return null;
  return { component, agreeing: vote.agreeing, of: vote.of };
}

const MAX_CODE_POINTERS = 5;

/**
 * Places in the project's indexed repos a first search on the ticket's text
 * found: path, lines and the names defined there, never the code itself, so
 * the agent reads them or searches further rather than answering from them.
 */
async function codePointers(search: TicketSearch, repoSlugs: string[]) {
  if (!repoSlugs.length || !search.query.trim()) return [];
  const hits = await searchCode(search.query, {
    repoSlugs,
    queryVectors: search.queryVectors,
    exactTerms: search.exactTerms,
    limit: MAX_CODE_POINTERS,
  });
  return hits
    .filter((hit: any) => hit.grade !== "weak")
    .map((hit: any) => ({
      repo: hit.repo_slug,
      path: hit.path,
      lines: `${hit.start_line}-${hit.end_line}`,
      grade: hit.grade,
      ...(hit.defines.length ? { defines: hit.defines } : {}),
    }));
}

tool(
  "get_context",
  {
    description:
      "Fetch a work item AND auto-search the archive for similar prior cases in one call - the consult-mode entry point. Returns 'similar' (past knowledge entries with their full structured context) and 'reference' (matching project reference docs), each graded; check every similar entry's status, because a 'deprecated' one is outdated and must be flagged as such rather than presented as current advice. 'linked_items' holds the referenced Azure DevOps items, already fetched - read them, never re-fetch. 'project_context' names the ticket's project, its wiki and its repos with the component each implements: use it to aim search_code at the right repo instead of searching everything. 'code' points at places in those repos that a first search on the ticket's text found (path, lines, the names defined there): read them with read_code_file, and use search_code for more, since the ticket's words are not the code's. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
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

    const search = await ticketSearch(item.id, view.kept);
    const productId = item.productId ?? undefined;
    // The ticket's own customer lifts their history without excluding anyone
    // else's: the tiebreaker search_knowledge gives an explicit `customer`.
    const boostCustomerId = item.customerId ?? undefined;
    const boostUnitId = item.customerUnitId ?? undefined;
    const [similar, reference, { context, code }] = await Promise.all([
      searchKnowledge(search.query, {
        productId,
        limit,
        includeUnscoped: true,
        queryVectors: search.queryVectors,
        exactTerms: search.exactTerms,
        boostCustomerId,
        boostUnitId,
      }),
      searchReferenceDocs(search.query, {
        productId,
        limit,
        includeUnscoped: true,
        queryVectors: search.queryVectors,
        exactTerms: search.exactTerms,
        boostCustomerId,
      }),
      resolveProjectContext({ workItemId: item.id }).then(async (context) => ({
        context,
        code: await codePointers(search, indexedRepoSlugs(context)),
      })),
    ]);
    const retrievalMap = new TokenMap();
    const { item: workItem, ...compaction } = withCompaction(view.item);
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
      ...(code.length ? { code } : {}),
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
