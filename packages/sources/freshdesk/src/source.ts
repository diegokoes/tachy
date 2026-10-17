import {
  changeTagList,
  errorBody,
  fetchUntrustedUrl,
  sourceFetch,
} from "@tachy/core/sources";
import {
  customerStandIn,
  scrubbableCopy,
  scrubStrings,
  TokenMap,
} from "@tachy/core/compliance";
import {
  badInput,
  errorText,
  freshdeskToken,
  rememberSecret,
} from "@tachy/core/infra";
import { asNoteHtml } from "@tachy/core/work-items";
import type { FlowOption } from "@tachy/core";
import type {
  WorkItemSource,
  OpenedAttachment,
  RawAttachment,
  RawEvent,
  RawWorkItem,
  RawMessage,
  ListOptions,
  SourceFactory,
} from "@tachy/core/sources";

const PER_PAGE = 100;
/** Conversations page at the API default: `per_page` is unreliable there. */
const CONVERSATIONS_PER_PAGE = 30;
const MAX_AGENT_PAGES = 5;
const MAX_CONVERSATION_PAGES = 500;
const MAX_COMPANY_PAGES = 20;

function redactFreshdeskRaw(
  raw: unknown,
  map: TokenMap,
  customerSlug: string | null,
): unknown {
  const copy = scrubbableCopy(raw);
  if (!copy) return {};
  const name = customerStandIn(customerSlug);
  const email = (v: unknown) =>
    typeof v === "string" && v ? map.token("EMAIL", v) : v;
  const emailList = (v: unknown) =>
    Array.isArray(v)
      ? v.map((e) => (typeof e === "string" ? map.token("EMAIL", e) : e))
      : v;

  if (copy.email != null) copy.email = email(copy.email);
  if (copy.phone != null) copy.phone = map.token("PHONE", String(copy.phone));
  if (copy.name != null) copy.name = name;
  for (const key of [
    "cc_emails",
    "fwd_emails",
    "reply_cc_emails",
    "to_emails",
  ]) {
    if (copy[key] != null) copy[key] = emailList(copy[key]);
  }
  if (copy.twitter_id != null)
    copy.twitter_id = map.token("HANDLE", String(copy.twitter_id));
  if (copy.facebook_id != null)
    copy.facebook_id = map.token("HANDLE", String(copy.facebook_id));

  if (copy.requester && typeof copy.requester === "object") {
    const requester = copy.requester as Record<string, any>;
    if (requester.email != null) requester.email = email(requester.email);
    if (requester.mobile != null)
      requester.mobile = map.token("PHONE", String(requester.mobile));
    if (requester.phone != null)
      requester.phone = map.token("PHONE", String(requester.phone));
    if (requester.name != null) requester.name = name;
  }
  if (copy.company && typeof copy.company === "object") {
    const company = copy.company as Record<string, any>;
    if (company.name != null) company.name = name;
  }

  scrubStrings(copy, ["subject", "description", "description_text"], map);
  if (copy.custom_fields && typeof copy.custom_fields === "object")
    scrubStrings(copy.custom_fields, Object.keys(copy.custom_fields), map);
  return copy;
}

/** A file as Freshdesk lists it. Its docs show the size under either name. */
interface FreshdeskAttachment {
  id?: number;
  name?: string;
  content_type?: string;
  size?: number;
  file_size?: number;
  /** Signed, and good for five minutes from the read that returned it. */
  attachment_url?: string;
}

/**
 * The files of a ticket or a conversation. The `attachment_url` beside each
 * is left behind: one stored or shown is a dead link five minutes later.
 */
export function listedFiles(
  attachments: FreshdeskAttachment[] | undefined,
): RawAttachment[] {
  const files: RawAttachment[] = [];
  for (const file of attachments ?? []) {
    if (file?.id == null || !file.name) continue;
    const sizeBytes = file.size ?? file.file_size;
    files.push({
      id: String(file.id),
      name: file.name,
      ...(file.content_type ? { contentType: file.content_type } : {}),
      ...(typeof sizeBytes === "number" ? { sizeBytes } : {}),
    });
  }
  return files;
}

/** The size a file's host declares for it, when it declares one. */
function declaredLength(response: Response): number | undefined {
  const length = Number(response.headers.get("content-length"));
  return length > 0 ? length : undefined;
}

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

/** How a pasted picture's id reads, apart from a listed file's number. */
const PASTED = "inline-";

/**
 * The file a pasted picture's address names. The address is
 * `/inline/attachment?token=<JWT>` on a Freshdesk host or the helpdesk's own,
 * and the token's `id` claim is all in it that tells one file from another.
 */
function pastedId(src: string, helpdeskHost: string): string | null {
  if (!URL.canParse(src)) return null;
  const url = new URL(src);
  const onFreshdesk =
    url.host === helpdeskHost || url.host.endsWith(".freshdesk.com");
  if (url.protocol !== "https:" || !onFreshdesk) return null;
  if (url.pathname !== "/inline/attachment") return null;
  const claims = url.searchParams.get("token")?.split(".")[1];
  if (!claims) return null;
  try {
    const { id } = JSON.parse(Buffer.from(claims, "base64url").toString());
    const named = typeof id === "number" || typeof id === "string";
    return named && /^[\w-]{1,64}$/.test(String(id)) ? PASTED + id : null;
  } catch {
    return null;
  }
}

/** The pictures pasted into a message's HTML: each one's id and its address. */
function pastedSources(
  html: string | undefined,
  helpdeskHost: string,
): Map<string, string> {
  const sources = new Map<string, string>();
  for (const [, quoted] of (html ?? "").matchAll(IMG_SRC)) {
    const src = quoted.replace(/&amp;/g, "&");
    const id = pastedId(src, helpdeskHost);
    if (id && !sources.has(id)) sources.set(id, src);
  }
  return sources;
}

/**
 * The pictures pasted into a message. Freshdesk leaves them out of
 * `attachments`, and the name is only known once one is opened.
 */
function pastedImages(
  html: string | undefined,
  helpdeskHost: string,
): RawAttachment[] {
  return [...pastedSources(html, helpdeskHost).keys()].map((id) => ({
    id,
    name: "image.png",
    inline: true,
  }));
}

/**
 * A reply quotes the messages before it, pictures included: each picture
 * stays on the first message that has it.
 */
function withoutQuotedImages(messages: RawMessage[]): RawMessage[] {
  const seen = new Set<string>();
  return messages.map((message) => ({
    ...message,
    attachments: (message.attachments ?? []).filter((file) => {
      if (!file.inline) return true;
      if (seen.has(file.id)) return false;
      seen.add(file.id);
      return true;
    }),
  }));
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * What to call a pasted picture: the file name its address redirects to, or
 * failing that one made from the type its host declares.
 */
function pastedName(response: Response): string {
  const last = URL.canParse(response.url)
    ? new URL(response.url).pathname.split("/").pop()
    : undefined;
  if (last && /\.[A-Za-z0-9]{2,5}$/.test(last)) {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0];
  return `image.${IMAGE_EXTENSIONS[type.trim().toLowerCase()] ?? "png"}`;
}

/** The parts of Freshdesk's payloads this adapter reads. */
interface FreshdeskTicket {
  id: number;
  subject?: string;
  status?: number | null;
  group_id?: number | null;
  requester_id?: number | null;
  responder_id?: number | null;
  company_id?: number | null;
  priority?: number | null;
  type?: string | null;
  requester?: { email?: string; name?: string };
  /** With `include=stats`: the times it was first answered, resolved, closed. */
  stats?: Record<string, unknown> | null;
  description?: string;
  description_text?: string;
  attachments?: FreshdeskAttachment[];
  created_at?: string;
  updated_at?: string;
}

interface FreshdeskConversation {
  id: number;
  user_id?: number | null;
  automation_id?: number | null;
  auto_response?: boolean;
  incoming?: boolean;
  private?: boolean;
  from_email?: string;
  body?: string;
  body_text?: string;
  attachments?: FreshdeskAttachment[];
  created_at?: string;
}

interface FreshdeskAgent {
  id?: number;
  contact?: { name?: string; email?: string };
}

interface FreshdeskGroup {
  id: number;
  name?: string;
}

interface FreshdeskCompany {
  id: number;
  name?: string;
  custom_fields?: Record<string, unknown> | null;
}

interface FreshdeskTicketField {
  name: string;
  label?: string;
  default?: boolean;
  /** `custom_number`, `custom_checkbox`, `custom_dropdown`, ... */
  type?: string;
  choices?: unknown;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/**
 * What a ticket's own fields say happened to it: when it was opened, and each
 * time its stats give, `resolved_at` as `resolved`. The time is part of the
 * key, so a ticket resolved twice keeps both.
 */
function ticketEvents(ticket: FreshdeskTicket): RawEvent[] {
  const events: RawEvent[] = [];
  if (ticket.created_at)
    events.push({
      externalId: "created",
      occurredAt: ticket.created_at,
      field: "created",
    });
  for (const [key, value] of Object.entries(ticket.stats ?? {})) {
    if (typeof value !== "string" || !TIMESTAMP.test(value)) continue;
    events.push({
      externalId: `stats:${key}:${value}`,
      occurredAt: value,
      field: key.replace(/_at$/, ""),
    });
  }
  return events;
}

/** Where a default ticket field sits on a ticket, by the field's name. */
const TICKET_KEYS: Record<string, string> = {
  ticket_type: "type",
  group: "group_id",
  agent: "responder_id",
  company: "company_id",
  product: "product_id",
  requester: "requester_id",
};

/** Default ticket fields the update endpoint takes as numbers. */
const NUMBER_KEYS = new Set([
  "status",
  "priority",
  "source",
  "group_id",
  "responder_id",
  "product_id",
  "company_id",
  "requester_id",
]);

/** Text to the type the ticket field takes; throws on a bad number. */
export function typedValue(
  field: FreshdeskTicketField,
  value: string,
): string | number | boolean {
  const path = ticketFieldPath(field);
  const isNumeric =
    NUMBER_KEYS.has(path) ||
    field.type === "custom_number" ||
    field.type === "custom_decimal";
  if (isNumeric) {
    const parsed = Number(value);
    if (value.trim() === "" || Number.isNaN(parsed))
      throw new Error(
        `'${field.label ?? field.name}' takes a number, not '${value}'`,
      );
    return parsed;
  }
  if (field.type === "custom_checkbox")
    return value.trim().toLowerCase() === "true";
  return value;
}

const CUSTOM_PREFIX = "custom_fields.";

/** A ticket field's path on the ticket: custom ones live under custom_fields. */
export const ticketFieldPath = (f: FreshdeskTicketField) =>
  f.default ? (TICKET_KEYS[f.name] ?? f.name) : `custom_fields.${f.name}`;

/**
 * A ticket field's choices as options. Freshdesk shapes them by field: a list
 * for a dropdown, `{label: id}` for priority, source and group, `{id: [agent
 * label, customer label]}` for status, and nested objects for a dependent
 * field, whose first level is what the ticket stores.
 */
export function fieldChoices(choices: unknown): FlowOption[] {
  if (Array.isArray(choices))
    return choices.map((c) => ({ value: String(c), label: String(c) }));
  if (!choices || typeof choices !== "object") return [];
  return Object.entries(choices).map(([key, choice]) => {
    if (Array.isArray(choice))
      return { value: key, label: String(choice[0] ?? key) };
    if (typeof choice === "number" || typeof choice === "string")
      return { value: String(choice), label: key };
    return { value: key, label: key };
  });
}

/** Freshdesk adapter. Uses *_text fields, so no HTML stripping is needed. */
export const createFreshdeskSource: SourceFactory = (
  connection,
): WorkItemSource => {
  const token = connection.token || freshdeskToken(connection.slug);
  const auth =
    "Basic " + rememberSecret(Buffer.from(`${token}:X`).toString("base64"));
  const base = connection.baseUrl.replace(/\/$/, "");
  const api = base + "/api/v2";
  const helpdeskHost = URL.canParse(base) ? new URL(base).host : "";

  async function get<T>(path: string): Promise<T> {
    const response = await sourceFetch(
      `Freshdesk GET ${path}`,
      api + path,
      { headers: { Authorization: auth } },
      { connection: connection.slug },
    );
    if (!response.ok)
      throw new Error(
        `Freshdesk GET ${path} -> ${response.status} ${await errorBody(response)}`,
      );
    return (await response.json()) as T;
  }

  /** A ticket's conversations, a page at a time, oldest first. */
  async function* conversationPages(
    ticketId: string,
  ): AsyncGenerator<FreshdeskConversation[]> {
    for (let page = 1; page <= MAX_CONVERSATION_PAGES; page++) {
      const batch = await get<FreshdeskConversation[]>(
        `/tickets/${ticketId}/conversations?page=${page}`,
      );
      if (!Array.isArray(batch) || batch.length === 0) return;
      yield batch;
      if (batch.length < CONVERSATIONS_PER_PAGE) return;
    }
  }

  /**
   * Each message of a ticket as it reads now, oldest first: the files it
   * lists and its HTML. A listed file's address only opens for five minutes,
   * so one is always taken from a read just made; a caller that stops early
   * reads no further page.
   */
  async function* messagesNow(ticketId: string): AsyncGenerator<{
    files: FreshdeskAttachment[] | undefined;
    html: string | undefined;
  }> {
    const ticket = await get<FreshdeskTicket>(`/tickets/${ticketId}`);
    yield { files: ticket.attachments, html: ticket.description };
    for await (const conversations of conversationPages(ticketId))
      for (const conversation of conversations)
        yield { files: conversation.attachments, html: conversation.body };
  }

  /**
   * The signature or token in the address is the whole grant, so the API key
   * is not sent with it, and no failure repeats the address: whoever reads one
   * can open the file.
   */
  async function openAddress(address: string | undefined): Promise<Response> {
    if (!address || !URL.canParse(address))
      throw new Error("Freshdesk gave no address for the file");
    const response = await fetchUntrustedUrl("Freshdesk file", address);
    if (!response.ok || !response.body)
      throw new Error(`Freshdesk file -> ${response.status}`);
    return response;
  }

  async function openListed(
    file: FreshdeskAttachment,
    attachmentId: string,
  ): Promise<OpenedAttachment> {
    const response = await openAddress(file.attachment_url);
    return {
      name: file.name ?? attachmentId,
      ...(file.content_type ? { contentType: file.content_type } : {}),
      sizeBytes: file.size ?? file.file_size ?? declaredLength(response),
      body: response.body!,
    };
  }

  async function openPasted(src: string): Promise<OpenedAttachment> {
    const response = await openAddress(src);
    const type = response.headers.get("content-type");
    return {
      name: pastedName(response),
      ...(type ? { contentType: type } : {}),
      sizeBytes: declaredLength(response),
      body: response.body!,
    };
  }

  async function putTicket(
    externalId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const response = await sourceFetch(
      "Freshdesk ticket PUT",
      `${api}/tickets/${encodeURIComponent(externalId)}`,
      {
        method: "PUT",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { connection: connection.slug },
    );
    if (!response.ok)
      throw new Error(
        `Freshdesk ticket PUT -> ${response.status} ${await errorBody(response)}`,
      );
  }

  let agentNames: Map<string, string> | null = null;
  /**
   * Best-effort: a non-admin key may not list agents, and unnamed turns still
   * read fine.
   */
  async function loadAgentNames(): Promise<Map<string, string>> {
    if (agentNames) return agentNames;
    const names = new Map<string, string>();
    try {
      for (let page = 1; page <= MAX_AGENT_PAGES; page++) {
        const batch = await get<FreshdeskAgent[]>(
          `/agents?per_page=${PER_PAGE}&page=${page}`,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const agent of batch) {
          const name = agent?.contact?.name;
          if (agent?.id != null && name) names.set(String(agent.id), name);
        }
        if (batch.length < PER_PAGE) break;
      }
    } catch {
      // Keep whatever was collected.
    }
    agentNames = names;
    return names;
  }

  function senderLabel(
    conversation: FreshdeskConversation,
    names: Map<string, string>,
  ): string | undefined {
    if (conversation.automation_id != null) return "support (automated)";
    if (conversation.incoming) {
      const emailMatch = String(conversation.from_email ?? "").match(
        /[\w.+-]+@[\w.-]+/,
      );
      if (emailMatch) return emailMatch[0].toLowerCase();
    }
    if (conversation.user_id != null) {
      const name = names.get(String(conversation.user_id));
      if (name) return name;
    }
    return undefined;
  }

  function mapConversation(
    conversation: FreshdeskConversation,
    names: Map<string, string>,
  ): RawMessage {
    return {
      externalId: String(conversation.id),
      author:
        conversation.user_id != null ? String(conversation.user_id) : undefined,
      authorLabel: senderLabel(conversation, names),
      automated:
        conversation.automation_id != null ||
        conversation.auto_response === true,
      visibility: conversation.private ? "private" : "public",
      direction: conversation.incoming ? "incoming" : "outgoing",
      bodyText: conversation.body_text ?? "",
      attachments: [
        ...listedFiles(conversation.attachments),
        ...pastedImages(conversation.body, helpdeskHost),
      ],
      createdAt: conversation.created_at,
    };
  }

  function metadataToItem(
    ticket: FreshdeskTicket,
    messages: RawMessage[],
  ): RawWorkItem {
    return {
      externalId: String(ticket.id),
      externalUrl: `${base}/a/tickets/${ticket.id}`,
      kind: "ticket",
      title: ticket.subject,
      status: ticket.status != null ? String(ticket.status) : undefined,
      groupKey: ticket.group_id != null ? String(ticket.group_id) : undefined,
      assignee:
        ticket.responder_id != null ? String(ticket.responder_id) : undefined,
      priority: ticket.priority != null ? String(ticket.priority) : undefined,
      itemType: ticket.type ?? undefined,
      requester:
        ticket.requester_id != null ? String(ticket.requester_id) : undefined,
      requesterEmail: ticket.requester?.email,
      requesterName: ticket.requester?.name,
      raw: ticket,
      sourceCreatedAt: ticket.created_at,
      sourceUpdatedAt: ticket.updated_at,
      messages,
      events: ticketEvents(ticket),
      customerKey:
        ticket.company_id != null ? String(ticket.company_id) : undefined,
    };
  }

  /** A company's record one level deep: its custom fields beside the standard ones. */
  async function companyRecord(
    companyId: unknown,
  ): Promise<Record<string, unknown> | null> {
    if (companyId == null) return null;
    const { custom_fields, ...company } = await get<FreshdeskCompany>(
      `/companies/${encodeURIComponent(String(companyId))}`,
    );
    return { ...company, ...(custom_fields ?? {}) };
  }

  return {
    type: "freshdesk",
    capabilities: { postNote: true, incrementalSync: true },
    // The first message is the description, read from the same ticket.
    modelOmits: ["description", "description_text"],
    redactRaw: redactFreshdeskRaw,

    async verify() {
      const me = await get<FreshdeskAgent>("/agents/me");
      const identity = me?.contact?.email ?? me?.contact?.name ?? undefined;
      // /groups is admin-only; a plain agent key 403s here and still reads
      // tickets fine, so the failure is reported, not thrown.
      try {
        const groups = await get<FreshdeskGroup[]>(
          `/groups?per_page=${PER_PAGE}`,
        );
        return {
          identity,
          groups: (Array.isArray(groups) ? groups : []).map((g) => ({
            key: String(g.id),
            name: g.name ?? String(g.id),
          })),
        };
      } catch (e) {
        return {
          identity,
          groups: [],
          groupsNote: errorText(e),
        };
      }
    },

    async fetchItem(externalId: string): Promise<RawWorkItem> {
      // The id arrives from a route parameter, so it is encoded rather than
      // pasted: unescaped it could carry its own query string into the path.
      const ticketId = encodeURIComponent(externalId);
      const ticket = await get<FreshdeskTicket>(
        `/tickets/${ticketId}?include=requester,stats`,
      );
      const convos: FreshdeskConversation[] = [];
      for await (const batch of conversationPages(ticketId))
        convos.push(...batch);
      // Loaded even when no agent replied: redaction needs the colleagues a
      // thread only mentions. The map is cached for the life of the adapter.
      const names = await loadAgentNames();
      const description: RawMessage = {
        externalId: `desc-${ticket.id}`,
        author:
          ticket.requester_id != null ? String(ticket.requester_id) : undefined,
        authorLabel: ticket.requester?.email?.toLowerCase(),
        visibility: "public",
        direction: "incoming",
        bodyText: ticket.description_text ?? "",
        attachments: [
          ...listedFiles(ticket.attachments),
          ...pastedImages(ticket.description, helpdeskHost),
        ],
        createdAt: ticket.created_at,
      };
      const messages = withoutQuotedImages(
        [description, ...convos.map((c) => mapConversation(c, names))].sort(
          (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
        ),
      );
      // Best effort: a key that may not read companies still reads the ticket.
      const company = await companyRecord(ticket.company_id).catch(() => null);
      return {
        ...metadataToItem(ticket, messages),
        knownPeople: [...names.values()],
        ...(company
          ? {
              customerRecord: {
                name:
                  typeof company.name === "string" ? company.name : undefined,
                record: company,
              },
            }
          : {}),
      };
    },

    async openAttachment(externalId, attachmentId) {
      const pasted = attachmentId.startsWith(PASTED);
      for await (const message of messagesNow(encodeURIComponent(externalId))) {
        const src = pasted
          ? pastedSources(message.html, helpdeskHost).get(attachmentId)
          : undefined;
        if (src) return openPasted(src);
        const file = pasted
          ? undefined
          : message.files?.find((listed) => String(listed.id) === attachmentId);
        if (file) return openListed(file, attachmentId);
      }
      throw badInput(`ticket ${externalId} lists no file '${attachmentId}'`);
    },

    async listItems(opts: ListOptions) {
      const params = new URLSearchParams();
      params.set("per_page", String(PER_PAGE));
      params.set("order_by", "updated_at");
      params.set("order_type", "asc");
      if (opts.updatedSince) params.set("updated_since", opts.updatedSince);
      // The times a ticket was first answered, resolved and closed.
      params.set("include", "stats");
      const page = opts.cursor ? Number(opts.cursor) : 1;
      params.set("page", String(page));

      const list = await get<FreshdeskTicket[]>(
        `/tickets?${params.toString()}`,
      );
      const raw = Array.isArray(list) ? list : [];
      let items = raw.map((t): RawWorkItem => ({
        ...metadataToItem(t, []),
        listed: true,
      }));
      if (opts.groupKey)
        items = items.filter((i) => i.groupKey === opts.groupKey);

      const nextCursor = raw.length < PER_PAGE ? undefined : String(page + 1);
      return { items, nextCursor };
    },

    async deleteNote(messageId) {
      const response = await sourceFetch(
        "Freshdesk conversation DELETE",
        `${api}/conversations/${messageId}`,
        { method: "DELETE", headers: { Authorization: auth } },
        { connection: connection.slug },
      );
      // Already gone is the wanted end state.
      if (!response.ok && response.status !== 404)
        throw new Error(
          `Freshdesk conversation DELETE -> ${response.status} ${await errorBody(response)}`,
        );
    },

    async setFields(externalId, fields) {
      const listed = await get<FreshdeskTicketField[]>("/ticket_fields");
      const ticketFields = Array.isArray(listed) ? listed : [];
      const body: Record<string, unknown> = {};
      const custom: Record<string, unknown> = {};
      for (const [path, value] of Object.entries(fields)) {
        const field = ticketFields.find((f) => ticketFieldPath(f) === path);
        if (!field) throw new Error(`Freshdesk has no ticket field '${path}'`);
        if (path.startsWith(CUSTOM_PREFIX))
          custom[path.slice(CUSTOM_PREFIX.length)] = typedValue(field, value);
        else body[path] = typedValue(field, value);
      }
      if (Object.keys(custom).length) body.custom_fields = custom;
      await putTicket(externalId, body);
    },

    async options(name, params) {
      if (name === "agents")
        return [...(await loadAgentNames())]
          .map(([id, agentName]) => ({ value: id, label: agentName, hint: id }))
          .sort((a, b) => a.label.localeCompare(b.label));
      if (name === "companies") {
        const companies: FlowOption[] = [];
        for (let page = 1; page <= MAX_COMPANY_PAGES; page++) {
          const batch = await get<FreshdeskCompany[]>(
            `/companies?per_page=${PER_PAGE}&page=${page}`,
          );
          if (!Array.isArray(batch) || !batch.length) break;
          for (const company of batch)
            companies.push({
              value: String(company.id),
              label: company.name ?? String(company.id),
            });
          if (batch.length < PER_PAGE) break;
        }
        return companies.sort((a, b) => a.label.localeCompare(b.label));
      }
      if (name === "company_fields") {
        const fields = await get<FreshdeskTicketField[]>("/company_fields");
        return (Array.isArray(fields) ? fields : []).map((f) => ({
          value: f.name,
          label: f.label ?? f.name,
          hint: f.default ? undefined : "custom",
        }));
      }
      if (
        name === "ticket_fields" ||
        name === "field_choices" ||
        name === "groups"
      ) {
        const fields = await get<FreshdeskTicketField[]>("/ticket_fields");
        const list = Array.isArray(fields) ? fields : [];
        // An agent's key reads group names only as the group field's choices.
        if (name === "groups") {
          const field = list.find((f) => f.default && f.name === "group");
          return field ? fieldChoices(field.choices) : [];
        }
        if (name === "ticket_fields")
          return list.map((f) => ({
            value: ticketFieldPath(f),
            label: f.label ?? f.name,
            hint: f.default ? undefined : "custom",
          }));
        const want = params.field?.replace(/^item\.raw\./, "");
        const field = list.find((x) => ticketFieldPath(x) === want);
        return field ? fieldChoices(field.choices) : [];
      }
      return [];
    },

    customerRecord: (raw) =>
      companyRecord((raw as { company_id?: unknown } | null)?.company_id),

    async setTags(externalId, change) {
      const path = `/tickets/${encodeURIComponent(externalId)}`;
      const ticket = await get<{ tags?: string[] }>(path);
      const tags = changeTagList(ticket.tags ?? [], change);
      await putTicket(externalId, { tags });
      return tags;
    },

    async postNote(externalId, body, opts) {
      const response = await sourceFetch(
        "Freshdesk note POST",
        `${api}/tickets/${encodeURIComponent(externalId)}/notes`,
        {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            body: asNoteHtml(body),
            private: opts?.private ?? true,
          }),
        },
        { connection: connection.slug },
      );
      if (!response.ok)
        throw new Error(
          `Freshdesk note POST -> ${response.status} ${await errorBody(response)}`,
        );
    },
  };
};
