import {
  customerStandIn,
  freshdeskToken,
  scrubbableCopy,
  scrubStrings,
  sourceFetch,
  TokenMap,
} from "@tachy/core";
import type {
  WorkItemSource,
  RawWorkItem,
  RawMessage,
  ListOptions,
  SourceFactory,
} from "@tachy/core";

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
