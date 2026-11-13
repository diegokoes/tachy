/**
 * The vocabularies a ticket is filed against (resolution patterns, components,
 * and the customers and units that own an install, shaped by each product's
 * blueprint) and who owns what: teams, their products, and the labels shared
 * across them.
 */
import { z } from "zod";
import {
  getCustomerIdBySlug,
  getProductIdBySlug,
  listTeams,
  addTeam,
  listProducts,
  addProduct,
  listLabels,
  addLabel,
  getTeamIdBySlug,
  listResolutionPatterns,
  addResolutionPattern,
  listComponents,
  addComponent,
  listCustomers,
  addCustomer,
  getCustomerProfile,
  setCustomerFact,
  listCustomerFactKinds,
  linkCustomerComponent,
  unlinkCustomerComponent,
  listCustomerUnits,
  addCustomerUnit,
  resolveUnit,
  resolveComponentStrict,
  getProductBlueprint,
  addUnitKind,
  resolveUnitAnywhere,
  searchCustomers,
  type CustomerProfile,
} from "@tachy/core/catalog";
import { badInput } from "@tachy/core/infra";
import { tool } from "../server";
import { out, outScrubbed } from "../results";
import {
  audited,
  mcpActor,
  requireCanEdit,
  requireCanManageTeam,
  requireCustomerPartEditor,
  requireGlobalAdmin,
  requireAnyTeamAdmin,
} from "../permissions";

tool(
  "list_resolution_patterns",
  {
    description:
      "List the controlled vocabulary of resolution patterns. ALWAYS call this before choosing resolution_pattern for save_knowledge_entry - pick an existing slug, or leave it unset, rather than inventing one.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listResolutionPatterns()),
);

tool(
  "add_resolution_pattern",
  {
    description:
      "Add a new resolution_pattern slug to the controlled vocabulary. Call ONLY when the user explicitly asks to add a new pattern - never invent one just to tag a ticket; leave resolution_pattern unset instead.",
    inputSchema: { slug: z.string(), description: z.string() },
    check: () => requireAnyTeamAdmin(),
  },
  async ({ slug, description }) => {
    return out(
      await audited("catalog_add", `pattern:${slug}`, () =>
        addResolutionPattern(slug, description),
      ),
    );
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
      "Add (or update) a fact in the architecture glossary, e.g. a service, module, or config pool. Call it whenever a component is genuinely missing - when the user describes the architecture, or when a ticket names an area absent from the list. The review box is where the user refuses one they don't want, so never work around a missing component by inventing a slug inline or forcing the entry onto an unrelated one. Use aliases for alternate names (e.g. slug 'line-controller' with aliases ['lc','LC']) so naming variants resolve to one component.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string(),
      name: z.string(),
      parent_slug: z.string().optional(),
      description: z.string().optional(),
      aliases: z.array(z.string()).optional(),
    },
    check: async ({ product_slug }) =>
      requireCanEdit({ productId: await getProductIdBySlug(product_slug) }),
  },
  async (args) => {
    const productId = await getProductIdBySlug(args.product_slug);
    return out(
      await audited(
        "catalog_add",
        `component:${args.product_slug}/${args.slug}`,
        () =>
          addComponent({
            productId,
            slug: args.slug,
            name: args.name,
            parentSlug: args.parent_slug,
            description: args.description,
            aliases: args.aliases,
          }),
      ),
    );
  },
);

tool(
  "list_customers",
  {
    description:
      "List known customers with their aliases (other NAMES the account trades under), email_domains (sender domains that resolve to it, including a partner or distributor who raises tickets on their behalf) and the products they use. Use to check before correcting a work item's customer. With product_slug, only customers that use that product; with component as well, only those that run that component - who else a fix or a regression touches.",
    inputSchema: {
      product_slug: z.string().optional(),
      component: z
        .string()
        .optional()
        .describe("Slug or alias from list_components. Needs product_slug."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug, component }) => {
    if (component && !product_slug)
      throw badInput("component resolves within a product: pass product_slug");
    const productId = product_slug
      ? await getProductIdBySlug(product_slug)
      : undefined;
    const componentId =
      component && productId
        ? (await resolveComponentStrict(productId, component)).id
        : undefined;
    return out(await listCustomers({ productId, componentId }));
  },
);

tool(
  "add_customer",
  {
    description:
      "Add (or extend) a customer. Call when the user describes a customer, asks to add one, or a ticket names one that is unresolved but unambiguous; the review box is their chance to refuse it. Pass product_slug for the product the ticket or the user is about: the teams of a customer's products are who may edit it.",
    inputSchema: {
      name: z.string(),
      slug: z.string(),
      aliases: z
        .array(z.string())
        .optional()
        .describe(
          "Other NAMES this account trades under. Not email domains - a domain here would come back out of list_customers as something to call them.",
        ),
      email_domains: z
        .array(z.string())
        .optional()
        .describe(
          "Sender domains that mean this customer, including a partner or distributor who raises tickets for them (arkwell.example on Dalmoor, losvanetrade.example on Losvane). A domain listed on two customers deliberately resolves to neither, so give a shared integrator's domain to nobody.",
        ),
      notes: z.string().optional(),
      product_slug: z
        .string()
        .optional()
        .describe("A product the customer uses, linked as it is added."),
    },
    check: async ({ product_slug }) => {
      await requireAnyTeamAdmin();
      if (product_slug)
        await requireCanEdit({
          productId: await getProductIdBySlug(product_slug),
        });
    },
  },
  async (args) => {
    const productId = args.product_slug
      ? await getProductIdBySlug(args.product_slug)
      : null;
    return out(
      await audited("catalog_add", `customer:${args.slug}`, async () =>
        addCustomer(
          {
            name: args.name,
            slug: args.slug,
            aliases: args.aliases,
            emailDomains: args.email_domains,
            notes: args.notes,
            productIds: productId ? [productId] : [],
          },
          await mcpActor(),
        ),
      ),
    );
  },
);

/** Said only when a profile carries blueprint gaps or disagreements. */
function profileNote(profile: CustomerProfile): Record<string, string> {
  const parts = [
    profile.missing?.length
      ? "`missing` names facts this unit's blueprint asks for that nothing records yet: when the conversation states one, propose set_customer_fact."
      : "",
    profile.conflicts.length
      ? "`conflicts` are units and facts that do not fit their product's blueprint; mention one when it bears on the answer, and leave curating them to the user."
      : "",
  ].filter(Boolean);
  return parts.length ? { note: parts.join(" ") } : {};
}

tool(
  "get_customer_profile",
  {
    description:
      "Everything configured about one customer's install: the customer-wide specifics (their version, integrations, contract), the products they use, the parts their setup divides into (`units` - sites, production lines, integrations, each tied to a product or general), the components they run, their repos and projects, and how many entries and docs are filed under them. Call it before advising a named customer - a general answer can be wrong for them because of what is here. Pass `unit` for one part of their setup: the facts come back RESOLVED for it, each with `origin` and `inherited`, plus the facts its blueprint still misses and the docs and entries filed around it. A unit can be named without its customer when its name is unique. Arrives automatically on fetch_work_item/get_context when the ticket resolves to a customer, so do not re-fetch it then.",
    inputSchema: {
      customer: z
        .string()
        .optional()
        .describe("Slug from list_customers. Optional when unit names one."),
      unit: z
        .string()
        .optional()
        .describe(
          "Unit slug or alias from list_customer_units, e.g. a line or an integration.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ customer, unit }) => {
    if (!customer && !unit) throw badInput("name a customer, a unit, or both");
    const customerId = customer
      ? await getCustomerIdBySlug(customer)
      : (await resolveUnitAnywhere(unit!)).customer_id;
    const profile = (await getCustomerProfile(customerId, unit))!;
    return outScrubbed({ ...profile, ...profileNote(profile) });
  },
);

tool(
  "search_customers",
  {
    description:
      "Find customer data by what it says: which customers run SAP, where line PLN191 is, who records coding mode CT2. Matches customer names, slugs, aliases and email domains; unit names, slugs, aliases and kinds; and fact kinds, labels and values. Answers in three groups; follow up with get_customer_profile. With product_slug, only that product's customers and setups.",
    inputSchema: {
      query: z.string().min(1),
      product_slug: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, product_slug }) =>
    outScrubbed(
      await searchCustomers(query, {
        productId: product_slug
          ? await getProductIdBySlug(product_slug)
          : undefined,
      }),
    ),
);

tool(
  "list_customer_units",
  {
    description:
      "The parts one customer's setup divides into - sites, production lines, integrations, tenants - with the product each belongs to, how they nest, and which template each follows. A unit of a product with a blueprint has one of its kinds (get_product_blueprint); a general unit, with no product, takes any kind. Read this before set_customer_fact with a unit, or before answering a question about a named line or site: a fact recorded against a line is not visible on the customer as a whole.",
    inputSchema: { customer: z.string().describe("Slug from list_customers") },
    annotations: { readOnlyHint: true },
  },
  async ({ customer }) => {
    const units = await listCustomerUnits(await getCustomerIdBySlug(customer));
    if (!units.length)
      return out({
        units: [],
        note: "This customer's setup is not broken down into units, so every fact about them is customer-wide.",
      });
    const slugById = new Map(units.map((u) => [u.id, u.slug]));
    return out({
      units: units.map((u) => ({
        slug: u.slug,
        name: u.name,
        kind: u.kind,
        product: u.product_slug,
        parent: u.parent_id ? (slugById.get(u.parent_id) ?? null) : null,
        template: u.template_id ? (slugById.get(u.template_id) ?? null) : null,
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
      "Add (or update) one part of a customer's setup. `product_slug` ties it to a product's setup: its kind, where it sits and the template it follows must then fit that product's blueprint (get_product_blueprint), and the refusal names what fits. Leave product_slug off for a general unit, which takes any kind. `parent` is containment - a line is inside a site. `template` is sharing WITHOUT containment: the layout several lines follow, whose facts they inherit without being part of it. Do not invent units from ticket text - propose one and let the user confirm.",
    inputSchema: {
      customer: z.string().describe("Slug from list_customers"),
      slug: z.string().describe("Short identifier, e.g. 'pln191'"),
      name: z.string(),
      kind: z
        .string()
        .describe(
          "What sort of part this is, e.g. site, line, layout, integration",
        ),
      product_slug: z
        .string()
        .optional()
        .describe("The product whose setup this unit is part of."),
      parent: z
        .string()
        .optional()
        .describe("The unit that CONTAINS this one."),
      template: z
        .string()
        .optional()
        .describe(
          "A unit whose facts this one inherits without being inside it - a shared layout.",
        ),
      aliases: z
        .array(z.string())
        .optional()
        .describe("Other names the site calls it by."),
      notes: z.string().optional(),
    },
    check: async ({ customer, product_slug }) => {
      await requireAnyTeamAdmin();
      await requireCustomerPartEditor(
        await getCustomerIdBySlug(customer),
        product_slug ? await getProductIdBySlug(product_slug) : null,
      );
    },
  },
  async (args) => {
    const productId = args.product_slug
      ? await getProductIdBySlug(args.product_slug)
      : null;
    return out(
      await audited(
        "catalog_add",
        `unit:${args.customer}/${args.slug}`,
        async () =>
          addCustomerUnit(
            {
              customerSlug: args.customer,
              slug: args.slug,
              name: args.name,
              kind: args.kind,
              productId,
              parentSlug: args.parent,
              templateSlug: args.template,
              aliases: args.aliases,
              notes: args.notes,
            },
            await mcpActor(),
          ),
      ),
    );
  },
);

tool(
  "list_customer_fact_kinds",
  {
    description:
      "The kinds of customer specific already recorded in this deployment (version, environment, layout, …), with usage counts. The vocabulary is deployment-specific, so call this before set_customer_fact and reuse an existing kind rather than coining a near-duplicate. On a unit of a product with a blueprint, the blueprint decides the kinds instead.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listCustomerFactKinds()),
);

tool(
  "set_customer_fact",
  {
    description:
      "Record one specific about a customer's install - the version they run, their line layout, an integration they depend on. This is where customer-specific truth belongs; a knowledge entry is for a problem and its resolution, so do not use one to store what is really a configuration fact. Re-setting the same (unit, kind, label) replaces the value, so this is how a version gets updated rather than duplicated. Pass `unit` when the fact is true of one part of their setup rather than of the whole account - an IP belongs to a line, a timezone to a site. On a unit of a product with a blueprint the kind must be one the blueprint lists for that unit's kind, and a value from its choices when it has some; elsewhere call list_customer_fact_kinds first and reuse a kind. Credentials and card numbers are refused: record where a secret is kept, never the secret.",
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
          "What it is about when the kind alone is ambiguous - which device an address belongs to, which line a layout describes. Together with kind it identifies the fact, so reuse it to update rather than add.",
        ),
      value: z.string(),
      notes: z.string().optional(),
      source: z
        .string()
        .optional()
        .describe(
          "Where this was learned - a ticket URL, a wiki page, a person.",
        ),
      product_slug: z.string().optional(),
      component: z
        .string()
        .optional()
        .describe(
          "Pin the fact to one component. Needs product_slug on a customer-wide fact; a unit's product is used otherwise.",
        ),
      doc: z
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe(
          "Id of the library doc that details this fact - a drawing, an interface spec. null removes the link.",
        ),
    },
    check: async (args) => {
      await requireAnyTeamAdmin();
      const customerId = await getCustomerIdBySlug(args.customer);
      const unit = args.unit ? await resolveUnit(customerId, args.unit) : null;
      await requireCustomerPartEditor(customerId, unit?.product_id ?? null);
    },
  },
  async (args) => {
    return out(
      await audited("catalog_update", `customer:${args.customer}`, async () =>
        setCustomerFact(
          {
            customerSlug: args.customer,
            unit: args.unit,
            kind: args.kind,
            label: args.label,
            value: args.value,
            notes: args.notes,
            source: args.source,
            componentSlug: args.component,
            productId: args.product_slug
              ? await getProductIdBySlug(args.product_slug)
              : null,
            ...("doc" in args ? { docId: args.doc } : {}),
          },
          await mcpActor(),
        ),
      ),
    );
  },
);

tool(
  "set_customer_component",
  {
    description:
      "Record that a customer runs a component, or that they no longer do (linked: false). Many-to-many on purpose: a shared component has many customers, one built for a single customer has just that one. list_customers with product_slug and component answers 'who else runs this?' before a fix is treated as safe for everyone.",
    inputSchema: {
      customer: z.string().describe("Slug from list_customers"),
      product_slug: z.string(),
      component: z.string().describe("Slug or alias from list_components"),
      linked: z.boolean().optional().describe("false removes the link"),
      notes: z.string().optional(),
    },
    check: async ({ product_slug }) => {
      await requireAnyTeamAdmin();
      await requireCanEdit({
        productId: await getProductIdBySlug(product_slug),
      });
    },
  },
  async (args) => {
    const productId = await getProductIdBySlug(args.product_slug);
    return out(
      await audited("catalog_update", `customer:${args.customer}`, async () => {
        const actor = await mcpActor();
        return args.linked === false
          ? unlinkCustomerComponent(
              args.customer,
              productId,
              args.component,
              actor,
            )
          : linkCustomerComponent(args.customer, productId, args.component, {
              notes: args.notes,
              actor,
            });
      }),
    );
  },
);

tool(
  "get_product_blueprint",
  {
    description:
      "A product's blueprint: the kinds of unit its customers' setups divide into (a site holding production lines that follow a layout; the integrations of a reporting product), where each kind sits, which template kind it follows, and the facts each kind records, with their choices when the values are a closed list. No kinds means the product has no blueprint and its units are free form. Read it before add_customer_unit or set_customer_fact on a unit of that product.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) =>
    out(await getProductBlueprint(await getProductIdBySlug(product_slug))),
);

tool(
  "add_unit_kind",
  {
    description:
      "Add a kind of unit to a product's blueprint, or extend one: where it sits (`parent_kind`), the template kind its units may follow, and the facts it records. Facts given are added or updated, never removed. Call it when the user describes how a product's customers are set up, or alongside a set_customer_fact or add_customer_unit that a blueprint refused because the kind or fact is missing - its own review box is the user's chance to refuse it.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string().describe("Lowercase key, e.g. 'line', 'integration'"),
      name: z.string(),
      description: z.string().optional(),
      parent_kind: z
        .string()
        .optional()
        .describe("The kind a unit of this kind sits inside, e.g. 'site'."),
      template_kind: z
        .string()
        .optional()
        .describe("The kind of template its units may follow, e.g. 'layout'."),
      facts: z
        .array(
          z.object({
            kind: z.string().describe("Lowercase key, e.g. 'ip'"),
            description: z.string().optional(),
            choices: z
              .array(z.string())
              .optional()
              .describe("Every value the fact may take; omit for any value."),
          }),
        )
        .optional(),
    },
    check: async ({ product_slug }) =>
      requireCanEdit({ productId: await getProductIdBySlug(product_slug) }),
  },
  async (args) => {
    const productId = await getProductIdBySlug(args.product_slug);
    return out(
      await audited(
        "catalog_add",
        `blueprint:${args.product_slug}/${args.slug}`,
        () =>
          addUnitKind({
            productId,
            slug: args.slug,
            name: args.name,
            description: args.description,
            parentKind: args.parent_kind,
            templateKind: args.template_kind,
            facts: args.facts,
          }),
      ),
    );
  },
);

tool(
  "list_teams",
  {
    description:
      "List all teams. Call this to discover team slugs before calling add_product, list_products, or search_knowledge with a team filter.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const teams = await listTeams();
    return out(teams.length ? teams : { teams, note: NO_TEAMS });
  },
);

const NO_TEAMS =
  "No team exists: this system is new. Set it up with the user, each step in its own box: add_team, then add_product under it, then list_source_connections.";

tool(
  "add_team",
  {
    description:
      "Add (or rename) a team. The slug is a short kebab-case identifier used by all other tools.",
    inputSchema: { slug: z.string(), name: z.string() },
    check: () => requireGlobalAdmin(),
  },
  async ({ slug, name }) => {
    return out(
      await audited("catalog_add", `team:${slug}`, () => addTeam(slug, name)),
    );
  },
);

tool(
  "list_products",
  {
    description:
      "List all products, optionally filtered by team slug. Call this to discover product slugs before calling list_components, search_knowledge with a product filter, or add_source_project.",
    inputSchema: { team_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ team_slug }) => out(await listProducts(team_slug)),
);

tool(
  "add_product",
  {
    description:
      "Add (or rename) a product under a team. The slug is used by components, knowledge search, and source mappings. Use aliases for alternate names (e.g. slug 'tqx' with aliases ['Trade Quota Exchange']) so they all resolve to this product.",
    inputSchema: {
      team_slug: z.string(),
      slug: z.string(),
      name: z.string(),
      aliases: z.array(z.string()).optional(),
    },
    check: async ({ team_slug }) =>
      requireCanManageTeam(await getTeamIdBySlug(team_slug)),
  },
  async ({ team_slug, slug, name, aliases }) => {
    return out(
      await audited("catalog_add", `product:${team_slug}/${slug}`, () =>
        addProduct(team_slug, slug, name, aliases),
      ),
    );
  },
);

tool(
  "list_labels",
  {
    description:
      "List the optional, per-product advisory tag vocabulary. Call this before tagging a knowledge entry so you reuse existing tag slugs (e.g. 'lc', 'mas', 'printing') instead of inventing near-duplicates. An empty list is normal - tags are free-form, this is just a curated suggestion list.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) =>
    out(await listLabels(await getProductIdBySlug(product_slug))),
);

tool(
  "add_label",
  {
    description:
      "Add a tag slug to a product's advisory label vocabulary. Call when the user wants to curate the team's taxonomy - not inferred silently. Tags on knowledge entries remain free-form; this only records a preferred vocabulary.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string(),
      description: z.string().optional(),
    },
    check: async ({ product_slug }) =>
      requireCanEdit({ productId: await getProductIdBySlug(product_slug) }),
  },
  async ({ product_slug, slug, description }) => {
    const productId = await getProductIdBySlug(product_slug);
    return out(
      await audited("catalog_add", `label:${product_slug}/${slug}`, () =>
        addLabel(productId, slug, description),
      ),
    );
  },
);
