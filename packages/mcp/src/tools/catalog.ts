import { z } from "zod";
import {
  listResolutionPatterns,
  addResolutionPattern,
  listComponents,
  addComponent,
  getProductIdBySlug,
  listCustomers,
  addCustomer,
  getCustomerIdBySlug,
  getCustomerProfile,
  setCustomerFact,
  listCustomerFactKinds,
  linkCustomerComponent,
  unlinkCustomerComponent,
  listEnvironments,
  listCustomerUnits,
  addCustomerUnit,
} from "@tachy/core";
import { tool } from "../server";
import { out } from "../results";
import { requireAnyTeamAdmin, requireCanEdit } from "../permissions";

/**
 * The vocabularies a ticket is filed against — resolution patterns,
 * environments, components, and the customers and units that own an install.
 */

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
