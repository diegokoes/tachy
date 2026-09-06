import { z } from "zod";
import {
  getProductIdBySlug,
  listTeams,
  addTeam,
  listProducts,
  addProduct,
  listLabels,
  addLabel,
  getTeamIdBySlug,
} from "@tachy/core";
import { tool } from "../server";
import { out } from "../results";
import {
  requireCanEdit,
  requireCanManageTeam,
  requireGlobalAdmin,
} from "../permissions";

/**
 * Who owns what: teams, their products, and the labels shared across them.
 */

tool(
  "list_teams",
  {
    description:
      "List all teams. Call this to discover team slugs before calling add_product, list_products, or search_knowledge with a team filter.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listTeams()),
);

tool(
  "add_team",
  {
    description:
      "Add (or rename) a team. The slug is a short kebab-case identifier used by all other tools.",
    inputSchema: { slug: z.string(), name: z.string() },
  },
  async ({ slug, name }) => {
    await requireGlobalAdmin();
    return out(await addTeam(slug, name));
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
      "Add (or rename) a product under a team. The slug is used by components, knowledge search, and source mappings. Use aliases for alternate names (e.g. slug 'tpd' with aliases ['Tobacco Product Directive']) so they all resolve to this product.",
    inputSchema: {
      team_slug: z.string(),
      slug: z.string(),
      name: z.string(),
      aliases: z.array(z.string()).optional(),
    },
  },
  async ({ team_slug, slug, name, aliases }) => {
    await requireCanManageTeam(await getTeamIdBySlug(team_slug));
    return out(await addProduct(team_slug, slug, name, aliases));
  },
);

tool(
  "list_labels",
  {
    description:
      "List the optional, per-product advisory tag vocabulary. Call this before tagging a knowledge entry so you reuse existing tag slugs (e.g. 'lc', 'mas', 'printing') instead of inventing near-duplicates. An empty list is normal — tags are free-form, this is just a curated suggestion list.",
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
      "Add a tag slug to a product's advisory label vocabulary. Call when the user wants to curate the team's taxonomy — not inferred silently. Tags on knowledge entries remain free-form; this only records a preferred vocabulary.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string(),
      description: z.string().optional(),
    },
  },
  async ({ product_slug, slug, description }) => {
    const productId = await getProductIdBySlug(product_slug);
    await requireCanEdit({ productId });
    return out(await addLabel(productId, slug, description));
  },
);
