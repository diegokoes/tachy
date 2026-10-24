import { z } from "zod";
import {
  getCustomerIdBySlug,
  getCustomerProfile,
  setWorkItemCustomer,
} from "../catalog/customers";
import { readableBucket } from "../buckets/access";
import { searchBucket } from "../buckets/search";
import { searchCode } from "../code/search";
import { listTeamMembers } from "../access/users";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { notify } from "../notifications/notifications";
import { searchKnowledge } from "../knowledge/knowledge";
import { searchReferenceDocs } from "../reference/reference";
import { getSourceProject } from "../sources/projects";
import { resolveSource } from "../sources/registry";
import { followWorkItem } from "../work-items/follows";
import { asNoteHtml, renderNote } from "../work-items/note-html";
import { ingestWorkItem } from "../work-items/ingest";
import { extractAdoRefs } from "../work-items/linked-refs";
import { recordAdoRefs } from "../work-items/links";
import { readStoredRaw } from "../work-items/stored";
import { defineFlowAction, type FlowActionContext } from "./actions";
import { flowName } from "./definitions";
import { customerProperties } from "./customer";
import { applyIngest, getIngestConfig, ingestConfig } from "./ingest";
import { applyFormConfig, getComposeConfig, typeConfig } from "./forms";
import type { FlowSubject } from "./subject";

const needItem = (ctx: FlowActionContext): FlowSubject => {
  if (!ctx.item) throw badInput("this step needs an item to work on");
  return ctx.item;
};

const options = (key: string, extra: Record<string, unknown> = {}) => ({
  "x-options": key,
  ...extra,
});

const query = z
  .string()
  .min(1)
  .default("{{item.title}}")
  .describe("What to look for. Defaults to the item's title.");
const limit = z.number().int().min(1).max(20).default(5);

const hits = z.object({
  results: z.array(z.record(z.string(), z.unknown())),
  count: z.number(),
  /** The results as a few lines each, ready for a prompt or a note. */
  text: z.string(),
});

const lines = (rows: Record<string, unknown>[], pick: (row: any) => string) =>
  rows.map((r, i) => `${i + 1}. ${pick(r)}`).join("\n");

async function recipientsOf(
  ctx: FlowActionContext,
  to: "owner" | "team",
): Promise<string[]> {
  if (to === "owner") return ctx.userId ? [ctx.userId] : [];
  if (!ctx.item?.team) return [];
  return (await listTeamMembers(ctx.item.team)).map((m) => m.user_id);
}

async function wasNotified(
  userId: string,
  ref: { flow_id: string; step_id: string; work_item_id: string | null },
): Promise<boolean> {
  const [hit] = await sql`
    select 1 from notifications
    where user_id = ${userId} and kind = 'flow_notice'
      and ref->>'flow_id' = ${ref.flow_id}
      and ref->>'step_id' = ${ref.step_id}
      and ref->>'work_item_id' is not distinct from ${ref.work_item_id}
    limit 1
  `;
  return !!hit;
}

let registered = false;

/** Idempotent: every caller that needs the library asks for it first. */
export function registerBuiltinFlowActions(): void {
  if (registered) return;
  registered = true;

  defineFlowAction({
    key: "item.fetch",
    title: "read ticket",
    description:
      "fetches the item fresh from its source and stores it. messages the source's ingest rules skip are left out",
    category: "read",
    writes: false,
    params: z.object({}),
    output: z.object({
      title: z.string().nullable(),
      status: z.string().nullable(),
      messages: z.array(
        z.object({
          direction: z.string(),
          visibility: z.string(),
          author: z.string().nullable(),
          text: z.string(),
          at: z.string().nullable(),
        }),
      ),
      text: z.string(),
      guidance: z.string().nullable(),
    }),
    async run(ctx) {
      const item = needItem(ctx);
      const { conn, source } = await resolveSource(item.connection, ctx.scope);
      const raw = await source.fetchItem(item.external_id);
      await ingestWorkItem(conn.id, raw);
      const { kept, guidance } = applyIngest(
        raw,
        ingestConfig(conn.config),
        source.modelOmits,
      );
      const messages = kept.messages.map((m) => ({
        direction: m.direction,
        visibility: m.visibility,
        author: m.authorLabel ?? m.author ?? null,
        text: m.bodyText,
        at: m.createdAt ?? null,
      }));
      return {
        title: raw.title ?? null,
        status: raw.status ?? null,
        messages,
        text: messages
          .map((m) => `[${m.direction} ${m.author ?? ""}] ${m.text}`.trim())
          .join("\n\n"),
        guidance: guidance ?? null,
      };
    },
  });

  defineFlowAction({
    key: "knowledge.search",
    title: "search knowledge",
    description:
      "past resolutions for the item's product and team, its customer's first",
    category: "search",
    writes: false,
    params: z.object({ query, limit }),
    output: hits,
    async run(ctx, params) {
      const rows = (await searchKnowledge(params.query, {
        productId: ctx.item?.product_id ?? undefined,
        teamId: ctx.item?.team_id ?? undefined,
        includeUnscoped: true,
        boostCustomerId: ctx.item?.customer_id ?? undefined,
        limit: params.limit,
      })) as unknown as Record<string, unknown>[];
      return {
        results: rows,
        count: rows.length,
        text: lines(
          rows,
          (r) => `${r.issue_summary ?? ""} → ${r.resolution ?? ""}`,
        ),
      };
    },
  });

  defineFlowAction({
    key: "code.search",
    title: "search code",
    description: "indexed repositories, narrowed to the item's product",
    category: "search",
    writes: false,
    params: z.object({
      query,
      repo: z
        .string()
        .optional()
        .meta(options("repos"))
        .describe("one repository instead of the product's"),
      limit,
    }),
    output: hits,
    async run(ctx, params) {
      const rows = (await searchCode(params.query, {
        repoSlug: params.repo,
        productId: params.repo
          ? undefined
          : (ctx.item?.product_id ?? undefined),
        customerId: ctx.item?.customer_id ?? undefined,
        limit: params.limit,
      })) as unknown as Record<string, unknown>[];
      return {
        results: rows,
        count: rows.length,
        text: lines(rows, (r) => `${r.repo_slug}/${r.path}`),
      };
    },
  });

  defineFlowAction({
    key: "reference.search",
    title: "search reference docs",
    description: "approved docs and wiki articles for the item's product",
    category: "search",
    writes: false,
    params: z.object({ query, limit }),
    output: hits,
    async run(ctx, params) {
      const rows = (await searchReferenceDocs(params.query, {
        productId: ctx.item?.product_id ?? undefined,
        teamId: ctx.item?.team_id ?? undefined,
        includeUnscoped: true,
        limit: params.limit,
      })) as unknown as Record<string, unknown>[];
      return {
        results: rows,
        count: rows.length,
        text: lines(rows, (r) => String(r.title ?? r.id)),
      };
    },
  });

  defineFlowAction({
    key: "bucket.search",
    title: "search bucket",
    description:
      "one bucket of pushed documents, such as a product's public knowledge base. only buckets shared with the flow's owner",
    category: "search",
    writes: false,
    params: z.object({
      bucket: z.string().min(1).meta(options("buckets")),
      query,
      limit,
    }),
    output: hits,
    async run(ctx, params) {
      const bucket = await readableBucket(ctx.userId, params.bucket);
      const rows = (await searchBucket(params.query, {
        bucketIds: [bucket.id],
        limit: params.limit,
      })) as unknown as Record<string, unknown>[];
      return {
        results: rows,
        count: rows.length,
        text: lines(rows, (r) => `${r.title}${r.url ? ` (${r.url})` : ""}`),
      };
    },
  });

  defineFlowAction({
    key: "customer.profile",
    title: "customer profile",
    description: "what tachy knows about the item's customer",
    category: "read",
    writes: false,
    params: z.object({}),
    output: z.object({
      found: z.boolean(),
      profile: z.record(z.string(), z.unknown()).nullable(),
    }),
    async run(ctx) {
      const item = needItem(ctx);
      const profile = item.customer_id
        ? await getCustomerProfile(item.customer_id)
        : null;
      return {
        found: !!profile,
        profile: profile as Record<string, unknown> | null,
      };
    },
  });

  defineFlowAction({
    key: "customer.properties",
    title: "customer properties",
    description:
      "picked values of the item's customer: tachy's facts and the source's company fields. redacted when redaction is on",
    category: "read",
    writes: false,
    params: z.object({
      keys: z
        .array(z.string().min(1))
        .min(1)
        .meta(
          options("customer.properties", {
            "x-free": true,
            title: "properties",
          }),
        ),
    }),
    output: z.object({
      found: z.boolean(),
      customer: z.string().nullable(),
      values: z
        .record(z.string(), z.string().nullable())
        .meta({ "x-keys-from": "keys" }),
      text: z.string(),
    }),
    async run(ctx, params) {
      const item = needItem(ctx);
      const got = await customerProperties(item, params.keys, ctx.scope);
      return {
        ...got,
        text: Object.entries(got.values)
          .map(([k, v]) => `${k}: ${v ?? "(none)"}`)
          .join("\n"),
      };
    },
  });

  const tags = z
    .array(z.string().min(1))
    .min(1)
    .meta(options("item.tags", { "x-free": true }));

  async function changeTags(
    ctx: FlowActionContext,
    change: { add: string[]; remove: string[] },
  ) {
    const item = needItem(ctx);
    const { source } = await resolveSource(item.connection, ctx.scope);
    if (!source.setTags)
      throw badInput(`${item.source_type} items cannot take tags`);
    const now = await source.setTags(item.external_id, change);
    item.tags = now;
    return { tags: now };
  }

  defineFlowAction({
    key: "item.add_tags",
    title: "add tags",
    description: "adds tags to the item in its source, keeping the ones it has",
    category: "update",
    writes: true,
    params: z.object({ tags }),
    output: z.object({ tags: z.array(z.string()) }),
    run: (ctx, params) => changeTags(ctx, { add: params.tags, remove: [] }),
  });

  defineFlowAction({
    key: "item.remove_tags",
    title: "remove tags",
    description:
      "takes tags off the item in its source; ones it lacks are fine",
    category: "update",
    writes: true,
    params: z.object({ tags }),
    output: z.object({ tags: z.array(z.string()) }),
    run: (ctx, params) => changeTags(ctx, { add: [], remove: params.tags }),
  });

  defineFlowAction({
    key: "item.set_field",
    title: "set field",
    description:
      "sets one of the ticket's fields in its source: status, priority, type, group, agent or a custom field",
    category: "update",
    source: "freshdesk",
    writes: true,
    params: z.object({
      field: z.string().min(1).meta(options("source.ticket_fields")),
      // A lone {{token}} keeps its type, so a model's JSON number arrives as a number.
      value: z.coerce
        .string()
        .min(1)
        .meta(
          options("source.field_choices", {
            "x-depends-on": ["field"],
            "x-free": true,
          }),
        )
        .describe("a choice, or text such as {{steps.<id>.json.priority}}"),
    }),
    output: z.object({ field: z.string(), value: z.string() }),
    async run(ctx, params) {
      const item = needItem(ctx);
      const { source } = await resolveSource(item.connection, ctx.scope);
      if (!source.setFields)
        throw badInput(`${item.source_type} items cannot have fields set`);
      await source.setFields(item.external_id, {
        [params.field]: params.value,
      });
      return { field: params.field, value: params.value };
    },
  });

  defineFlowAction({
    key: "notify",
    title: "notify",
    description:
      "a notice in tachy's changes menu, for the flow's owner or the item's team",
    category: "create",
    writes: true,
    params: z.object({
      to: z
        .enum(["owner", "team"])
        .default("owner")
        .describe("owner is whoever saved the flow last"),
      title: z.string().min(1).default("{{item.title}}"),
      body: z.string().default("").describe("takes {{steps.<id>.text}}"),
      once_per_item: z
        .boolean()
        .default(true)
        .describe("off notifies again on every run"),
    }),
    output: z.object({ sent: z.number(), skipped: z.number() }),
    async run(ctx, params) {
      const item = ctx.item;
      const recipients = await recipientsOf(ctx, params.to);
      const ref = {
        flow_id: ctx.flowId,
        step_id: ctx.stepId,
        work_item_id: item?.id ?? null,
        connection: item?.connection ?? null,
        external_id: item?.external_id ?? null,
        url: item?.url ?? null,
      };
      let sent = 0;
      for (const userId of recipients) {
        if (params.once_per_item && (await wasNotified(userId, ref))) continue;
        await notify({
          userId,
          kind: "flow_notice",
          title: params.title,
          body: params.body || null,
          ref,
        });
        sent++;
      }
      return { sent, skipped: recipients.length - sent };
    },
  });

  defineFlowAction({
    key: "item.follow_linked",
    title: "follow linked ADO items",
    description:
      "the flow's owner follows the Azure DevOps items the stored ticket names (read ticket first to store its messages), and is notified in tachy when someone else changes one",
    category: "update",
    writes: true,
    params: z.object({
      connection: z
        .string()
        .default("")
        .meta({ ...options("ado.connections"), title: "ADO connection" })
        .describe("empty: the first Azure DevOps connection"),
    }),
    output: z.object({ followed: z.array(z.string()) }),
    async run(ctx, params) {
      const item = needItem(ctx);
      if (!ctx.userId) throw badInput("the flow has no owner to follow as");
      const [adoConnection] = await sql<{ id: string }[]>`
        select id from source_connections where source_type = 'azure-devops'
          ${params.connection ? sql`and slug = ${params.connection}` : sql``}
        order by slug limit 1
      `;
      if (!adoConnection) throw badInput("no Azure DevOps source to follow on");
      const { kept } = applyIngest(
        await readStoredRaw(item.id),
        await getIngestConfig(item.connection),
      );
      const refs = extractAdoRefs(kept);
      for (const externalId of refs)
        await followWorkItem({
          userId: ctx.userId,
          connectionId: adoConnection.id,
          externalId,
        });
      await recordAdoRefs(item.id, refs, {
        sourceConnectionId: adoConnection.id,
        createdById: ctx.userId,
      });
      return { followed: refs };
    },
  });

  defineFlowAction({
    key: "item.post_note",
    title: "post note",
    description: "a note on the item in its source, private unless said",
    category: "update",
    source: "freshdesk",
    writes: true,
    params: z.object({
      title: z
        .string()
        .default("")
        .describe("the note's heading. empty: the flow's name"),
      body: z.string().min(1).describe("the note. takes {{steps.<id>.text}}"),
      private: z.boolean().default(true),
    }),
    output: z.object({ posted: z.boolean() }),
    async run(ctx, params) {
      const item = needItem(ctx);
      const { source } = await resolveSource(item.connection, ctx.scope);
      if (!source.postNote)
        throw badInput(`${item.source_type} items cannot take notes`);
      const flow = await flowName(ctx.flowId);
      const note = renderNote({
        kind: "analysis",
        externalId: item.external_id,
        title: params.title || flow || undefined,
        requestedBy: flow ? `Flow: ${flow}` : undefined,
        sections: [{ html: asNoteHtml(params.body) }],
        caveat: "Posted by a tachy flow.",
      });
      await source.postNote(item.external_id, note, {
        private: params.private,
      });
      return { posted: true };
    },
  });

  defineFlowAction({
    key: "ado.create_item",
    title: "create ADO item",
    description:
      "starts from the project's form as the team set it up, then these fields. linked to the item as tracked by",
    category: "create",
    source: "azure-devops",
    writes: true,
    params: z.object({
      project: z
        .string()
        .uuid()
        .meta(options("ado.projects"))
        .describe("a registered ADO project"),
      type: z
        .string()
        .min(1)
        .meta(options("ado.types", { "x-depends-on": ["project"] })),
      title: z.string().min(1).default("{{item.title}}"),
      fields: z
        .record(z.string(), z.unknown())
        .default({})
        .meta({ "x-form": "ado", "x-depends-on": ["project", "type"] })
        .describe("by reference name, e.g. System.Description"),
      tags: z.array(z.string()).optional(),
    }),
    output: z.object({
      id: z.union([z.string(), z.number()]),
      url: z.string(),
    }),
    async run(ctx, params) {
      const project = await getSourceProject(params.project);
      const { source } = await resolveSource(project.source_slug, ctx.scope);
      if (!source.composer)
        throw badInput(`${project.source_type} projects cannot create items`);
      const form = applyFormConfig(
        await source.composer.form(project.external_key, params.type, {
          projectConfig: project.config,
        }),
        typeConfig(await getComposeConfig(project.id), params.type),
      );
      const started = Object.fromEntries(
        Object.entries(form.prefill)
          .filter(([, v]) => v.origin !== "process")
          .map(([k, v]) => [k, v.value]),
      );
      const created = await source.composer.create(
        {
          project: project.external_key,
          type: params.type,
          title: params.title,
          fields: { ...started, ...params.fields },
          tags: params.tags,
        },
        {
          sourceSlug: project.source_slug,
          userId: ctx.userId,
          sourceProjectId: project.id,
          workItemIds: ctx.item ? [ctx.item.id] : undefined,
        },
        project.config,
      );
      return { id: created.id, url: created.url };
    },
  });

  defineFlowAction({
    key: "item.set_customer",
    title: "set customer",
    description: "attributes the item to a customer in tachy",
    category: "update",
    writes: true,
    params: z.object({
      customer: z.string().min(1).meta(options("customers")),
    }),
    output: z.object({ customer: z.string() }),
    async run(ctx, params) {
      const item = needItem(ctx);
      await setWorkItemCustomer(
        item.id,
        await getCustomerIdBySlug(params.customer),
      );
      return { customer: params.customer };
    },
  });

  defineFlowAction({
    key: "job.enqueue",
    title: "start job",
    description: "queues a job as part of the run, with its own parameters",
    category: "create",
    writes: true,
    params: z.object({
      kind: z.string().min(1).meta(options("job.kinds")),
      params: z
        .record(z.string(), z.unknown())
        .default({})
        .meta({ "x-form": "job", "x-depends-on": ["kind"] }),
    }),
    output: z.object({ run_id: z.string().nullable() }),
    async run(ctx, params) {
      if (params.kind === "flow.run")
        throw badInput("a flow cannot start a flow");
      return { run_id: await ctx.enqueue(params.kind, params.params) };
    },
  });
}
