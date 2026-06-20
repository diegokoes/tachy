import { freshdeskToken } from "@tachy/core";
import type {
  WorkItemSource, RawWorkItem, RawMessage, ListOptions, SourceFactory,
} from "@tachy/core";

/** Freshdesk adapter. Uses *_text fields, so no HTML stripping is needed. */
export const createFreshdeskSource: SourceFactory = (cfg): WorkItemSource => {
  const token = freshdeskToken(cfg.slug);
  const auth = "Basic " + Buffer.from(`${token}:X`).toString("base64");
  const base = cfg.baseUrl.replace(/\/$/, "");
  const api = base + "/api/v2";

  async function get(path: string): Promise<any> {
    const res = await fetch(api + path, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`Freshdesk GET ${path} -> ${res.status} ${await res.text()}`);
    return res.json();
  }

  function mapConversation(c: any): RawMessage {
    return {
      externalId: String(c.id),
      author: c.user_id != null ? String(c.user_id) : undefined,
      visibility: c.private ? "private" : "public",
      direction: c.incoming ? "incoming" : "outgoing",
      bodyText: c.body_text ?? "",
      attachments: c.attachments ?? [],
      createdAt: c.created_at,
    };
  }

  function metadataToItem(t: any, messages: RawMessage[]): RawWorkItem {
    return {
      externalId: String(t.id),
      externalUrl: `${base}/a/tickets/${t.id}`,
      kind: "ticket",
      title: t.subject,
      status: t.status != null ? String(t.status) : undefined,
      groupKey: t.group_id != null ? String(t.group_id) : undefined,
      requester: t.requester_id != null ? String(t.requester_id) : undefined,
      requesterEmail: t.requester?.email,    // only present when fetched with ?include=requester
      raw: t,
      sourceCreatedAt: t.created_at,
      sourceUpdatedAt: t.updated_at,
      messages,
    };
  }

  return {
    type: "freshdesk",
    capabilities: { postNote: true, incrementalSync: true },

    async fetchItem(externalId: string): Promise<RawWorkItem> {
      // include=requester costs 1 extra API credit but embeds the requester's
      // email inline (no second round-trip) for customer auto-matching by
      // domain. Skipped in listItems' bulk metadata sync to avoid doubling
      // the credit cost of every ticket in a sync run.
      const t = await get(`/tickets/${externalId}?include=requester`);
      const convos = await get(`/tickets/${externalId}/conversations`);
      const description: RawMessage = {
        externalId: `desc-${t.id}`,
        author: t.requester_id != null ? String(t.requester_id) : undefined,
        visibility: "public",
        direction: "incoming",
        bodyText: t.description_text ?? "",
        attachments: t.attachments ?? [],
        createdAt: t.created_at,
      };
      const messages = [description, ...(Array.isArray(convos) ? convos.map(mapConversation) : [])]
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return metadataToItem(t, messages);
    },

    async listItems(opts: ListOptions) {
      const params = new URLSearchParams();
      params.set("per_page", "100");
      params.set("order_by", "updated_at");
      params.set("order_type", "asc");
      if (opts.updatedSince) params.set("updated_since", opts.updatedSince);
      const page = opts.cursor ? Number(opts.cursor) : 1;
      params.set("page", String(page));

      const list = await get(`/tickets?${params.toString()}`);
      const raw = Array.isArray(list) ? list : [];
      let items = raw.map((t: any) => metadataToItem(t, [])); // metadata only on sync
      if (opts.groupKey) items = items.filter((i) => i.groupKey === opts.groupKey);
      // pagination decided by raw page size, not by the filtered count
      const nextCursor = raw.length < 100 ? undefined : String(page + 1);
      return { items, nextCursor };
    },

    async postNote(externalId, body, o) {
      const res = await fetch(`${api}/tickets/${externalId}/notes`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ body, private: o?.private ?? true }),
      });
      if (!res.ok) throw new Error(`Freshdesk note POST -> ${res.status} ${await res.text()}`);
    },
  };
};
