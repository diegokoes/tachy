import { changeTagList, sourceFetch } from "@tachy/core/sources";
import {
  customerStandIn,
  scrubbableCopy,
  scrubStrings,
  TokenMap,
} from "@tachy/core/compliance";
import { freshdeskToken } from "@tachy/core/infra";
import type { FlowOption } from "@tachy/core";
import type {
  WorkItemSource,
  RawWorkItem,
  RawMessage,
  ListOptions,
  SourceFactory,
} from "@tachy/core/sources";

function redactFreshdeskRaw(
  raw: unknown,
  map: TokenMap,
  customerSlug: string | null,
): unknown {
  const t = scrubbableCopy(raw);
  if (!t) return {};
  const name = customerStandIn(customerSlug);
  const email = (v: unknown) =>
    typeof v === "string" && v ? map.token("EMAIL", v) : v;
  const emailList = (v: unknown) =>
    Array.isArray(v)
      ? v.map((e) => (typeof e === "string" ? map.token("EMAIL", e) : e))
      : v;

  if (t.email != null) t.email = email(t.email);
  if (t.phone != null) t.phone = map.token("PHONE", String(t.phone));
  if (t.name != null) t.name = name;
  for (const k of ["cc_emails", "fwd_emails", "reply_cc_emails", "to_emails"]) {
    if (t[k] != null) t[k] = emailList(t[k]);
  }
  if (t.twitter_id != null)
    t.twitter_id = map.token("HANDLE", String(t.twitter_id));
  if (t.facebook_id != null)
    t.facebook_id = map.token("HANDLE", String(t.facebook_id));

  if (t.requester && typeof t.requester === "object") {
    const r = t.requester as Record<string, any>;
    if (r.email != null) r.email = email(r.email);
    if (r.mobile != null) r.mobile = map.token("PHONE", String(r.mobile));
    if (r.phone != null) r.phone = map.token("PHONE", String(r.phone));
    if (r.name != null) r.name = name;
  }
  if (t.company && typeof t.company === "object") {
    const c = t.company as Record<string, any>;
    if (c.name != null) c.name = name;
  }

  scrubStrings(t, ["subject", "description", "description_text"], map);
  if (t.custom_fields && typeof t.custom_fields === "object")
    scrubStrings(t.custom_fields, Object.keys(t.custom_fields), map);
  return t;
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
  return Object.entries(choices).map(([k, v]) =>
    Array.isArray(v)
      ? { value: k, label: String(v[0] ?? k) }
      : typeof v === "number" || typeof v === "string"
        ? { value: String(v), label: k }
        : { value: k, label: k },
  );
}

/** Freshdesk adapter. Uses *_text fields, so no HTML stripping is needed. */
export const createFreshdeskSource: SourceFactory = (cfg): WorkItemSource => {
  const token = cfg.token || freshdeskToken(cfg.slug);
  const auth = "Basic " + Buffer.from(`${token}:X`).toString("base64");
  const base = cfg.baseUrl.replace(/\/$/, "");
  const api = base + "/api/v2";

  async function get<T>(path: string): Promise<T> {
    const res = await sourceFetch(
      `Freshdesk GET ${path}`,
      api + path,
      { headers: { Authorization: auth } },
      { connection: cfg.slug },
    );
    if (!res.ok)
      throw new Error(
        `Freshdesk GET ${path} -> ${res.status} ${await res.text()}`,
      );
    return (await res.json()) as T;
  }

  let agentNames: Map<string, string> | null = null;
  /** Best-effort: a non-admin key may not list agents, and unnamed turns still read fine. */
  async function loadAgentNames(): Promise<Map<string, string>> {
    if (agentNames) return agentNames;
    const names = new Map<string, string>();
    try {
      for (let page = 1; page <= 5; page++) {
        const batch = await get<FreshdeskAgent[]>(
          `/agents?per_page=100&page=${page}`,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const a of batch) {
          const n = a?.contact?.name;
          if (a?.id != null && n) names.set(String(a.id), n);
        }
        if (batch.length < 100) break;
      }
    } catch {
      /* keep whatever was collected */
    }
    agentNames = names;
    return names;
  }

  function senderLabel(
    c: FreshdeskConversation,
    names: Map<string, string>,
  ): string | undefined {
    if (c.automation_id != null) return "support (automated)";
    if (c.incoming) {
      const m = String(c.from_email ?? "").match(/[\w.+-]+@[\w.-]+/);
      if (m) return m[0].toLowerCase();
    }
    if (c.user_id != null) {
      const n = names.get(String(c.user_id));
      if (n) return n;
    }
    return undefined;
  }

  function mapConversation(
    c: FreshdeskConversation,
    names: Map<string, string>,
  ): RawMessage {
    return {
      externalId: String(c.id),
      author: c.user_id != null ? String(c.user_id) : undefined,
      authorLabel: senderLabel(c, names),
      automated: c.automation_id != null || c.auto_response === true,
      visibility: c.private ? "private" : "public",
      direction: c.incoming ? "incoming" : "outgoing",
      bodyText: c.body_text ?? "",
      attachments: c.attachments ?? [],
      createdAt: c.created_at,
    };
  }

  function metadataToItem(
    t: FreshdeskTicket,
    messages: RawMessage[],
  ): RawWorkItem {
    return {
      externalId: String(t.id),
      externalUrl: `${base}/a/tickets/${t.id}`,
      kind: "ticket",
      title: t.subject,
      status: t.status != null ? String(t.status) : undefined,
      groupKey: t.group_id != null ? String(t.group_id) : undefined,
      requester: t.requester_id != null ? String(t.requester_id) : undefined,
      requesterEmail: t.requester?.email,
      requesterName: t.requester?.name,
      raw: t,
      sourceCreatedAt: t.created_at,
      sourceUpdatedAt: t.updated_at,
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
        const groups = await get<FreshdeskGroup[]>("/groups?per_page=100");
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
          groupsNote: e instanceof Error ? e.message : String(e),
        };
      }
    },

    async fetchItem(externalId: string): Promise<RawWorkItem> {
      // The id arrives from a route parameter, so it is encoded rather than
      // pasted: unescaped it could carry its own query string into the path.
      const ticketId = encodeURIComponent(externalId);
      const t = await get<FreshdeskTicket>(
        `/tickets/${ticketId}?include=requester`,
      );
      // Conversations page at 30 (the API default); per_page is unreliable on
      // some endpoints, so the loop keys on the observed default instead.
      const convos: FreshdeskConversation[] = [];
      for (let page = 1; page <= 500; page++) {
        const batch = await get<FreshdeskConversation[]>(
          `/tickets/${ticketId}/conversations?page=${page}`,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        convos.push(...batch);
        if (batch.length < 30) break;
      }
      // Loaded unconditionally, not just when an agent replied: redaction needs
      // the colleagues a thread only ever *mentions*, and the map is cached for
      // the life of the adapter, so this costs one directory read per process.
      const names = await loadAgentNames();
      const description: RawMessage = {
        externalId: `desc-${t.id}`,
        author: t.requester_id != null ? String(t.requester_id) : undefined,
        authorLabel: t.requester?.email?.toLowerCase(),
        visibility: "public",
        direction: "incoming",
        bodyText: t.description_text ?? "",
        attachments: t.attachments ?? [],
        createdAt: t.created_at,
      };
      const messages = [
        description,
        ...convos.map((c) => mapConversation(c, names)),
      ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return {
        ...metadataToItem(t, messages),
        knownPeople: [...names.values()],
      };
    },

    async listItems(opts: ListOptions) {
      const params = new URLSearchParams();
      params.set("per_page", "100");
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

      const nextCursor = raw.length < 100 ? undefined : String(page + 1);
      return { items, nextCursor };
    },

    async deleteNote(messageId) {
      const res = await sourceFetch(
        "Freshdesk conversation DELETE",
        `${api}/conversations/${messageId}`,
        { method: "DELETE", headers: { Authorization: auth } },
        { connection: cfg.slug },
      );
      // already gone is the desired end state, not a failure
      if (!res.ok && res.status !== 404)
        throw new Error(
          `Freshdesk conversation DELETE -> ${res.status} ${await res.text()}`,
        );
    },

    async options(name, params) {
      if (name === "companies") {
        const out: FlowOption[] = [];
        for (let page = 1; page <= 20; page++) {
          const batch = await get<FreshdeskCompany[]>(
            `/companies?per_page=100&page=${page}`,
          );
          if (!Array.isArray(batch) || !batch.length) break;
          for (const c of batch)
            out.push({ value: String(c.id), label: c.name ?? String(c.id) });
          if (batch.length < 100) break;
        }
        return out.sort((a, b) => a.label.localeCompare(b.label));
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
        const f = list.find((x) => ticketFieldPath(x) === want);
        return f ? fieldChoices(f.choices) : [];
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
      const res = await sourceFetch(
        "Freshdesk ticket PUT",
        api + path,
        {
          method: "PUT",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ tags }),
        },
        { connection: cfg.slug },
      );
      if (!res.ok)
        throw new Error(
          `Freshdesk ticket PUT -> ${res.status} ${await res.text()}`,
        );
      return tags;
    },

    async postNote(externalId, body, o) {
      const res = await sourceFetch(
        "Freshdesk note POST",
        `${api}/tickets/${encodeURIComponent(externalId)}/notes`,
        {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ body, private: o?.private ?? true }),
        },
        { connection: cfg.slug },
      );
      if (!res.ok)
        throw new Error(
          `Freshdesk note POST -> ${res.status} ${await res.text()}`,
        );
    },
  };
};
