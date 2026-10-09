import { changeTagList, sourceFetch } from "@tachy/core/sources";
import {
  customerStandIn,
  scrubbableCopy,
  scrubStrings,
  TokenMap,
} from "@tachy/core/compliance";
import { freshdeskToken, errorText, rememberSecret } from "@tachy/core/infra";
import { asNoteHtml } from "@tachy/core/work-items";
import type { FlowOption } from "@tachy/core";
import type {
  WorkItemSource,
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

/** The parts of Freshdesk's payloads this adapter reads. */
interface FreshdeskTicket {
  id: number;
  subject?: string;
  status?: number | null;
  group_id?: number | null;
  requester_id?: number | null;
  requester?: { email?: string; name?: string };
  description_text?: string;
  attachments?: unknown[];
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
  body_text?: string;
  attachments?: unknown[];
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
  choices?: unknown;
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

  async function get<T>(path: string): Promise<T> {
    const response = await sourceFetch(
      `Freshdesk GET ${path}`,
      api + path,
      { headers: { Authorization: auth } },
      { connection: connection.slug },
    );
    if (!response.ok)
      throw new Error(
        `Freshdesk GET ${path} -> ${response.status} ${await response.text()}`,
      );
    return (await response.json()) as T;
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
      attachments: conversation.attachments ?? [],
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
      requester:
        ticket.requester_id != null ? String(ticket.requester_id) : undefined,
      requesterEmail: ticket.requester?.email,
      requesterName: ticket.requester?.name,
      raw: ticket,
      sourceCreatedAt: ticket.created_at,
      sourceUpdatedAt: ticket.updated_at,
      messages,
    };
  }

  return {
    type: "freshdesk",
    capabilities: { postNote: true, incrementalSync: true },
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
        `/tickets/${ticketId}?include=requester`,
      );
      const convos: FreshdeskConversation[] = [];
      for (let page = 1; page <= MAX_CONVERSATION_PAGES; page++) {
        const batch = await get<FreshdeskConversation[]>(
          `/tickets/${ticketId}/conversations?page=${page}`,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        convos.push(...batch);
        if (batch.length < CONVERSATIONS_PER_PAGE) break;
      }
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
        attachments: ticket.attachments ?? [],
        createdAt: ticket.created_at,
      };
      const messages = [
        description,
        ...convos.map((c) => mapConversation(c, names)),
      ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return {
        ...metadataToItem(ticket, messages),
        knownPeople: [...names.values()],
      };
    },

    async listItems(opts: ListOptions) {
      const params = new URLSearchParams();
      params.set("per_page", String(PER_PAGE));
      params.set("order_by", "updated_at");
      params.set("order_type", "asc");
      if (opts.updatedSince) params.set("updated_since", opts.updatedSince);
      const page = opts.cursor ? Number(opts.cursor) : 1;
      params.set("page", String(page));

      const list = await get<FreshdeskTicket[]>(
        `/tickets?${params.toString()}`,
      );
      const raw = Array.isArray(list) ? list : [];
      let items = raw.map((t) => metadataToItem(t, []));
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
          `Freshdesk conversation DELETE -> ${response.status} ${await response.text()}`,
        );
    },

    async options(name, params) {
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
      if (name === "ticket_fields" || name === "field_choices") {
        const fields = await get<FreshdeskTicketField[]>("/ticket_fields");
        const list = Array.isArray(fields) ? fields : [];
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

    async customerRecord(raw) {
      const id = (raw as { company_id?: unknown } | null)?.company_id;
      if (id == null) return null;
      const { custom_fields, ...company } = await get<FreshdeskCompany>(
        `/companies/${encodeURIComponent(String(id))}`,
      );
      return { ...company, ...(custom_fields ?? {}) };
    },

    async setTags(externalId, change) {
      const path = `/tickets/${encodeURIComponent(externalId)}`;
      const ticket = await get<{ tags?: string[] }>(path);
      const tags = changeTagList(ticket.tags ?? [], change);
      const response = await sourceFetch(
        "Freshdesk ticket PUT",
        api + path,
        {
          method: "PUT",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ tags }),
        },
        { connection: connection.slug },
      );
      if (!response.ok)
        throw new Error(
          `Freshdesk ticket PUT -> ${response.status} ${await response.text()}`,
        );
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
          `Freshdesk note POST -> ${response.status} ${await response.text()}`,
        );
    },
  };
};
