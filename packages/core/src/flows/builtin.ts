import { z } from "zod";
import {
  getCustomerIdBySlug,
  getCustomerProfile,
  setWorkItemCustomer,
} from "../catalog/customers";
import { readableBucket } from "../buckets/access";
import { searchBucket } from "../buckets/search";
import { searchCode } from "../code/search";
import { badInput } from "../infra/errors";
import { searchKnowledge } from "../knowledge/knowledge";
import { searchReferenceDocs } from "../reference/reference";
import { getSourceProject } from "../sources/projects";
import { resolveSource } from "../sources/registry";
import { ingestWorkItem } from "../work-items/ingest";
import { defineFlowAction, type FlowActionContext } from "./actions";
import { customerProperties } from "./customer";
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

const lines = (rows: Record<string, unknown>[], pick: (r: any) => string) =>
  rows.map((r, i) => `${i + 1}. ${pick(r)}`).join("\n");

let registered = false;

/** Idempotent: every caller that needs the library asks for it first. */
export function registerBuiltinFlowActions(): void {
  if (registered) return;
  registered = true;

  defineFlowAction({
    key: "item.fetch",
    title: "Read ticket",
    description:
      "Fetches the item fresh from its source, with every message, and stores it.",
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
    }),
    async run(ctx) {
      const item = needItem(ctx);
      const { conn, source } = await resolveSource(item.connection, ctx.scope);
      const raw = await source.fetchItem(item.external_id);
      await ingestWorkItem(conn.id, raw);
      const messages = raw.messages.map((m) => ({
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
      };
    },
  });

  defineFlowAction({
    key: "knowledge.search",
    title: "Search knowledge",
    description:
      "Past resolutions for the item's product and team, its customer's first.",
    category: "search",
    writes: false,
    params: z.object({ query, limit }),
    output: hits,
    async run(ctx, p) {
      const rows = (await searchKnowledge(p.query, {
        productId: ctx.item?.product_id ?? undefined,
        teamId: ctx.item?.team_id ?? undefined,
        includeUnscoped: true,
        boostCustomerId: ctx.item?.customer_id ?? undefined,
        limit: p.limit,
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
    title: "Search code",
    description: "Indexed repositories, narrowed to the item's product.",
    category: "search",
    writes: false,
    params: z.object({
      query,
      repo: z
        .string()
        .optional()
        .meta(options("repos"))
        .describe("One repository instead of the product's."),
      limit,
    }),
    output: hits,
    async run(ctx, p) {
      const rows = (await searchCode(p.query, {
        repoSlug: p.repo,
        productId: p.repo ? undefined : (ctx.item?.product_id ?? undefined),
        customerId: ctx.item?.customer_id ?? undefined,
        limit: p.limit,
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
    title: "Search reference docs",
    description: "Approved docs and wiki articles for the item's product.",
    category: "search",
    writes: false,
    params: z.object({ query, limit }),
    output: hits,
    async run(ctx, p) {
      const rows = (await searchReferenceDocs(p.query, {
        productId: ctx.item?.product_id ?? undefined,
        teamId: ctx.item?.team_id ?? undefined,
        includeUnscoped: true,
        limit: p.limit,
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
    title: "Search bucket",
    description:
      "One bucket of pushed documents, such as a product's public knowledge base. Only buckets shared with the flow's owner.",
    category: "search",
    writes: false,
    params: z.object({
      bucket: z.string().min(1).meta(options("buckets")),
      query,
      limit,
    }),
    output: hits,
    async run(ctx, p) {
      const bucket = await readableBucket(ctx.userId, p.bucket);
      const rows = (await searchBucket(p.query, {
        bucketIds: [bucket.id],
        limit: p.limit,
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
    title: "Customer profile",
    description: "What tachy knows about the item's customer.",
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
    title: "Customer properties",
    description:
      "Picked values of the item's customer: tachy's facts and the source's company fields. Redacted when redaction is on.",
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
    async run(ctx, p) {
      const item = needItem(ctx);
      const got = await customerProperties(item, p.keys, ctx.scope);
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
    title: "Add tags",
    description:
      "Adds tags to the item in its source, keeping the ones it has.",
    category: "update",
    writes: true,
    params: z.object({ tags }),
    output: z.object({ tags: z.array(z.string()) }),
    run: (ctx, p) => changeTags(ctx, { add: p.tags, remove: [] }),
  });

  defineFlowAction({
    key: "item.remove_tags",
    title: "Remove tags",
    description:
      "Takes tags off the item in its source; ones it lacks are fine.",
    category: "update",
    writes: true,
    params: z.object({ tags }),
    output: z.object({ tags: z.array(z.string()) }),
    run: (ctx, p) => changeTags(ctx, { add: [], remove: p.tags }),
  });

  defineFlowAction({
    key: "item.post_note",
    title: "Post note",
    description: "A note on the item in its source, private unless said.",
    category: "update",
    source: "freshdesk",
    writes: true,
    params: z.object({
      body: z.string().min(1).describe("The note. Takes {{steps.<id>.text}}."),
      private: z.boolean().default(true),
    }),
    output: z.object({ posted: z.boolean() }),
    async run(ctx, p) {
      const item = needItem(ctx);
      const { source } = await resolveSource(item.connection, ctx.scope);
      if (!source.postNote)
        throw badInput(`${item.source_type} items cannot take notes`);
      await source.postNote(item.external_id, p.body, { private: p.private });
      return { posted: true };
    },
  });

  defineFlowAction({
    key: "ado.create_item",
    title: "Create ADO item",
    description:
      "Starts from the project's form as the team set it up, then these fields. Linked to the item as tracked by.",
    category: "create",
    source: "azure-devops",
    writes: true,
    params: z.object({
      project: z
        .string()
        .uuid()
        .meta(options("ado.projects"))
        .describe("A registered ADO project."),
      type: z
        .string()
        .min(1)
        .meta(options("ado.types", { "x-depends-on": ["project"] })),
      title: z.string().min(1).default("{{item.title}}"),
      fields: z
        .record(z.string(), z.unknown())
        .default({})
        .meta({ "x-form": "ado", "x-depends-on": ["project", "type"] })
        .describe("By reference name, e.g. System.Description."),
      tags: z.array(z.string()).optional(),
    }),
    output: z.object({
      id: z.union([z.string(), z.number()]),
      url: z.string(),
    }),
    async run(ctx, p) {
      const project = await getSourceProject(p.project);
      const { source } = await resolveSource(project.source_slug, ctx.scope);
      if (!source.composer)
        throw badInput(`${project.source_type} projects cannot create items`);
      const form = applyFormConfig(
        await source.composer.form(project.external_key, p.type, {
          projectConfig: project.config,
        }),
        typeConfig(await getComposeConfig(project.id), p.type),
      );
      const started = Object.fromEntries(
        Object.entries(form.prefill)
          .filter(([, v]) => v.origin !== "process")
          .map(([k, v]) => [k, v.value]),
      );
      const created = await source.composer.create(
        {
          project: project.external_key,
          type: p.type,
          title: p.title,
          fields: { ...started, ...p.fields },
          tags: p.tags,
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
    title: "Set customer",
    description: "Attributes the item to a customer in tachy.",
    category: "update",
    writes: true,
    params: z.object({
      customer: z.string().min(1).meta(options("customers")),
    }),
    output: z.object({ customer: z.string() }),
    async run(ctx, p) {
      const item = needItem(ctx);
      await setWorkItemCustomer(item.id, await getCustomerIdBySlug(p.customer));
      return { customer: p.customer };
    },
  });

  defineFlowAction({
    key: "job.enqueue",
    title: "Start job",
    description: "Queues a job as part of the run, with its own parameters.",
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
    async run(ctx, p) {
      if (p.kind === "flow.run") throw badInput("a flow cannot start a flow");
      return { run_id: await ctx.enqueue(p.kind, p.params) };
    },
  });
}
