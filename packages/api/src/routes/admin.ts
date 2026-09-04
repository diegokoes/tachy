import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listResolutionPatterns,
  addResolutionPattern,
  deleteResolutionPattern,
  resolutionPatternRenameImpact,
  renameResolutionPattern,
  listComponents,
  addComponent,
  updateComponent,
  deleteComponent,
  getProductIdBySlug,
  getCustomerIdBySlug,
  getCustomerProfile,
  listCustomerUnits,
  addCustomerUnit,
  updateCustomerUnit,
  deleteCustomerUnit,
  resolveUnitFacts,
  resolveUnit,
  setCustomerFact,
  deleteCustomerFact,
  listCustomerFactKinds,
  listCustomerFacts,
  linkCustomerComponent,
  unlinkCustomerComponent,
  componentRenameImpact,
  renameComponent,
  listCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  listTeams,
  catalogCensus,
  userCensus,
  sourceCensus,
  repoCensus,
  addTeam,
  updateTeam,
  deleteTeam,
  listProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  listLabels,
  addLabel,
  updateLabel,
  deleteLabel,
  labelRenameImpact,
  renameLabel,
  listSourceConnections,
  addSourceConnection,
  deleteSourceConnection,
  resolveSource,
  env,
  effectiveSettings,
  setSetting,
  secretsEnabled,
  credentialSource,
  setCredential,
  sourceCredentialName,
  badInput,
  AGENT_CREDENTIALS,
  type CredentialSource,
} from "@tachy/core";
import { requireAdmin } from "../auth";
import {
  assertAnyTeamAdminApi,
  assertScopeEditor,
  assertTeamAdmin,
  callerScope,
  requireCaller,
} from "../authz";

const slugField = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._/-]*$/,
    "slug must be lowercase (letters, digits, . _ / -)",
  );

const patternSchema = z.object({ slug: slugField, description: z.string() });
const componentSchema = z.object({
  slug: slugField,
  name: z.string(),
  parentSlug: z.string().optional(),
  description: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});
const customerSchema = z.object({
  name: z.string(),
  slug: slugField,
  aliases: z.array(z.string()).optional(),
  emailDomains: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
const teamSchema = z.object({ slug: slugField, name: z.string() });
const productSchema = z.object({
  team_slug: slugField,
  slug: slugField,
  name: z.string(),
  aliases: z.array(z.string()).optional(),
});
// Stricter than the generic slug: a connection slug also becomes a credential
// name (`freshdesk_token:<slug>`) and an env var (`FRESHDESK_TOKEN_<SLUG>`).
const connSlugField = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "connection slug must be lowercase letters, digits and hyphens",
  );

const sourceConnSchema = z.object({
  sourceType: z.string(),
  slug: connSlugField,
  baseUrl: z.string().optional(),
  config: z.record(z.string(), z.any()).optional(),
  /** Stored as the connection's global credential; never echoed back. */
  token: z.string().min(1).optional(),
});
/** Where the caller's token for a connection comes from — null when unset.
 *  Connections predating `connSlugField` may carry names the vault rejects. */
async function tokenSource(
  sourceType: string,
  slug: string,
  ctx: Awaited<ReturnType<typeof callerScope>>,
): Promise<CredentialSource | null> {
  try {
    return (
      (await credentialSource(sourceCredentialName(sourceType, slug), ctx)) ??
      null
    );
  } catch {
    return null;
  }
}

const labelSchema = z.object({
  slug: slugField,
  description: z.string().optional(),
});

const renameSchema = z.object({ to: slugField });

const customerUnitSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  parent: z.string().nullable().optional(),
  profile: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

const customerUnitPatchSchema = customerUnitSchema
  .partial()
  .omit({ slug: true });

const customerFactSchema = z.object({
  unit: z.string().nullable().optional(),
  kind: z.string().min(1),
  label: z.string().optional(),
  value: z.string().min(1),
  notes: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  product_slug: z.string().optional(),
  component: z.string().optional(),
});
const customerComponentSchema = z.object({
  product_slug: z.string(),
  component: z.string(),
  notes: z.string().nullable().optional(),
});
const customerPatchSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  emailDomains: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});
const componentPatchSchema = z.object({
  name: z.string().optional(),
  parentSlug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
});
const teamPatchSchema = z.object({
  name: z.string().optional(),
  slug: slugField.optional(),
});
const productPatchSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  slug: slugField.optional(),
  team_slug: slugField.optional(),
});
const labelPatchSchema = z.object({ description: z.string().nullable() });
const patternPatchSchema = z.object({ description: z.string() });

export const admin = new Hono()

  /**
   * The admin index's counts, in one request rather than one per section.
   * Composed here from each domain's own census: a count of teams belongs to
   * catalog and a count of repos to code, and nothing in core reaches across
   * to another domain's tables to produce this.
   */
  .get("/overview", async (c) => {
    const ctx = await callerScope(c);
    const [catalog, users, sources, repos, conns] = await Promise.all([
      catalogCensus(),
      userCensus(),
      sourceCensus(),
      repoCensus(),
      listSourceConnections(),
    ]);
    /* Through the same resolver the connections list uses, not a join against
       the vault: a token supplied by the environment is a token, and counting
       rows would have flagged every one of those as missing. */
    const untokened = (
      await Promise.all(
        conns.map((r) =>
          tokenSource(r.source_type as string, r.slug as string, ctx),
        ),
      )
    ).filter((s) => s === null).length;
    return c.json({
      counts: {
        sources: sources.connections,
        projects: sources.projects,
        repos: repos.repos,
        teams: catalog.teams,
        products: catalog.products,
        components: catalog.components,
        labels: catalog.labels,
        patterns: catalog.patterns,
        customers: catalog.customers,
        users: users.users,
      },
      warn: {
        sources: untokened,
        repos: repos.failing,
        users: users.disabled,
      },
    });
  })

  .get("/system", async (c) =>
    c.json({
      settings: await effectiveSettings(),
      credentials: {
        vault_enabled: secretsEnabled(),
        // Global-scope availability (source: global | env | null) — the
        // per-user view lives under /me/credentials.
        anthropic_api_key:
          (await credentialSource(AGENT_CREDENTIALS.claude, {})) ?? null,
        copilot_token:
          (await credentialSource(AGENT_CREDENTIALS.copilot, {})) ?? null,
      },
      env: {
        auth_mode: env.authMode,
        port: env.port,
        user_email: env.userEmail ?? null,
        oidc_configured: Boolean(env.oidc),
        api_token_set: Boolean(env.apiToken),
        session_secret_set: Boolean(env.sessionSecret),
        anthropic_api_key_set: Boolean(process.env.ANTHROPIC_API_KEY),
        copilot_token_set: Boolean(
          process.env.COPILOT_GITHUB_TOKEN ||
          process.env.GH_TOKEN ||
          process.env.GITHUB_TOKEN,
        ),
        upload_dir: process.env.TACHY_UPLOAD_DIR || null,
      },
    }),
  )

  .put(
    "/settings/:key",
    requireAdmin,
    zValidator("json", z.object({ value: z.unknown() })),
    async (c) => {
      await setSetting(c.req.param("key")!, c.req.valid("json").value);
      return c.json({ settings: await effectiveSettings() });
    },
  )
  .get("/resolution-patterns", async (c) =>
    c.json(await listResolutionPatterns()),
  )
  .post(
    "/resolution-patterns",
    zValidator("json", patternSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const { slug, description } = c.req.valid("json");
      return c.json(await addResolutionPattern(slug, description));
    },
  )
  .patch(
    "/resolution-patterns/:slug",
    zValidator("json", patternPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      return c.json(
        await addResolutionPattern(
          c.req.param("slug"),
          c.req.valid("json").description,
        ),
      );
    },
  )
  .delete("/resolution-patterns/:slug", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await deleteResolutionPattern(c.req.param("slug")));
  })
  .get("/resolution-patterns/:slug/rename-impact", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await resolutionPatternRenameImpact(c.req.param("slug")));
  })
  .post(
    "/resolution-patterns/:slug/rename",
    zValidator("json", renameSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      return c.json(
        await renameResolutionPattern(
          c.req.param("slug"),
          c.req.valid("json").to,
        ),
      );
    },
  )
  .get("/products/:slug/components", async (c) => {
    return c.json(
      await listComponents(await getProductIdBySlug(c.req.param("slug"))),
    );
  })
  .post(
    "/products/:slug/components",
    zValidator("json", componentSchema),
    async (c) => {
      const body = c.req.valid("json");
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(await addComponent({ ...body, productId }));
    },
  )
  .patch(
    "/products/:slug/components/:componentSlug",
    zValidator("json", componentPatchSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await updateComponent(
          productId,
          c.req.param("componentSlug"),
          c.req.valid("json"),
        ),
      );
    },
  )
  .delete("/products/:slug/components/:componentSlug", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(
      await deleteComponent(productId, c.req.param("componentSlug")),
    );
  })
  .get("/products/:slug/components/:componentSlug/rename-impact", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(
      await componentRenameImpact(productId, c.req.param("componentSlug")),
    );
  })
  .post(
    "/products/:slug/components/:componentSlug/rename",
    zValidator("json", renameSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await renameComponent(
          productId,
          c.req.param("componentSlug"),
          c.req.valid("json").to,
        ),
      );
    },
  )
  .get("/products/:slug/labels", async (c) => {
    return c.json(
      await listLabels(await getProductIdBySlug(c.req.param("slug"))),
    );
  })
  .post(
    "/products/:slug/labels",
    zValidator("json", labelSchema),
    async (c) => {
      const { slug, description } = c.req.valid("json");
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(await addLabel(productId, slug, description));
    },
  )
  .patch(
    "/products/:slug/labels/:labelSlug",
    zValidator("json", labelPatchSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await updateLabel(
          productId,
          c.req.param("labelSlug"),
          c.req.valid("json").description,
        ),
      );
    },
  )
  .delete("/products/:slug/labels/:labelSlug", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(await deleteLabel(productId, c.req.param("labelSlug")));
  })
  .get("/products/:slug/labels/:labelSlug/rename-impact", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(await labelRenameImpact(productId, c.req.param("labelSlug")));
  })
  .post(
    "/products/:slug/labels/:labelSlug/rename",
    zValidator("json", renameSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await renameLabel(
          productId,
          c.req.param("labelSlug"),
          c.req.valid("json").to,
        ),
      );
    },
  )
  .get("/customers", async (c) => c.json(await listCustomers()))
  .post("/customers", zValidator("json", customerSchema), async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await addCustomer(c.req.valid("json")));
  })
  .patch(
    "/customers/:slug",
    zValidator("json", customerPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      return c.json(
        await updateCustomer(c.req.param("slug"), c.req.valid("json")),
      );
    },
  )
  .delete("/customers/:slug", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await deleteCustomer(c.req.param("slug")));
  })

  // The customer's own install: their specifics, plus the records that are theirs.
  // ?unit= resolves the facts for one part of their estate, each carrying where
  // it came from, instead of listing the customer's flat set.
  .get("/customers/:slug/profile", async (c) =>
    c.json(
      await getCustomerProfile(
        await getCustomerIdBySlug(c.req.param("slug")),
        c.req.query("unit") ?? null,
      ),
    ),
  )
  .get("/customers/:slug/units", async (c) =>
    c.json(
      await listCustomerUnits(await getCustomerIdBySlug(c.req.param("slug"))),
    ),
  )
  .put(
    "/customers/:slug/units",
    zValidator("json", customerUnitSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const b = c.req.valid("json");
      return c.json(
        await addCustomerUnit({
          customerSlug: c.req.param("slug"),
          slug: b.slug,
          name: b.name,
          kind: b.kind,
          parentSlug: b.parent,
          profileSlug: b.profile,
          aliases: b.aliases,
          notes: b.notes,
        }),
      );
    },
  )
  .patch(
    "/customers/:slug/units/:unit",
    zValidator("json", customerUnitPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const b = c.req.valid("json");
      return c.json(
        await updateCustomerUnit(
          await getCustomerIdBySlug(c.req.param("slug")),
          c.req.param("unit"),
          {
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.kind !== undefined ? { kind: b.kind } : {}),
            ...("parent" in b ? { parentSlug: b.parent } : {}),
            ...("profile" in b ? { profileSlug: b.profile } : {}),
            ...(b.aliases !== undefined ? { aliases: b.aliases } : {}),
            ...("notes" in b ? { notes: b.notes } : {}),
          },
        ),
      );
    },
  )
  .delete("/customers/:slug/units/:unit", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(
      await deleteCustomerUnit(
        await getCustomerIdBySlug(c.req.param("slug")),
        c.req.param("unit"),
      ),
    );
  })
  // The resolved ladder for one unit, each fact carrying where it came from.
  .get("/customers/:slug/units/:unit/facts", async (c) => {
    const customerId = await getCustomerIdBySlug(c.req.param("slug"));
    const unit = await resolveUnit(customerId, c.req.param("unit"));
    return c.json(await resolveUnitFacts(unit.id));
  })
  .get("/customers/:slug/facts", async (c) =>
    c.json(
      await listCustomerFacts(await getCustomerIdBySlug(c.req.param("slug"))),
    ),
  )
  .get("/customer-fact-kinds", async (c) =>
    c.json(await listCustomerFactKinds()),
  )
  .put(
    "/customers/:slug/facts",
    zValidator("json", customerFactSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const b = c.req.valid("json");
      return c.json(
        await setCustomerFact({
          customerSlug: c.req.param("slug"),
          unit: b.unit,
          kind: b.kind,
          label: b.label,
          value: b.value,
          notes: b.notes,
          source: b.source,
          componentSlug: b.component,
          productId: b.product_slug
            ? await getProductIdBySlug(b.product_slug)
            : null,
        }),
      );
    },
  )
  .delete("/customers/:slug/facts/:id", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await deleteCustomerFact(c.req.param("id")));
  })
  .put(
    "/customers/:slug/components",
    zValidator("json", customerComponentSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const b = c.req.valid("json");
      return c.json(
        await linkCustomerComponent(
          c.req.param("slug"),
          await getProductIdBySlug(b.product_slug),
          b.component,
          b.notes,
        ),
      );
    },
  )
  .delete("/customers/:slug/components", async (c) => {
    await assertAnyTeamAdminApi(c);
    const productSlug = c.req.query("product_slug");
    const component = c.req.query("component");
    if (!productSlug || !component)
      throw badInput("product_slug and component are required");
    return c.json(
      await unlinkCustomerComponent(
        c.req.param("slug"),
        await getProductIdBySlug(productSlug),
        component,
      ),
    );
  })
  .get("/teams", async (c) => c.json(await listTeams()))
  .post("/teams", requireAdmin, zValidator("json", teamSchema), async (c) => {
    const { slug, name } = c.req.valid("json");
    return c.json(await addTeam(slug, name));
  })
  .patch(
    "/teams/:slug",
    requireAdmin,
    zValidator("json", teamPatchSchema),
    async (c) => {
      return c.json(
        await updateTeam(c.req.param("slug")!, c.req.valid("json")),
      );
    },
  )
  .delete("/teams/:slug", requireAdmin, async (c) => {
    return c.json(await deleteTeam(c.req.param("slug")!));
  })
  .get("/products", async (c) =>
    c.json(await listProducts(c.req.query("team_slug"))),
  )
  .post("/products", zValidator("json", productSchema), async (c) => {
    const { team_slug, slug, name, aliases } = c.req.valid("json");
    await assertTeamAdmin(c, team_slug);
    return c.json(await addProduct(team_slug, slug, name, aliases));
  })
  .patch(
    "/products/:slug",
    zValidator("json", productPatchSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      const b = c.req.valid("json");
      // Moving a product needs rights on the team it lands in, too.
      if (b.team_slug) await assertTeamAdmin(c, b.team_slug);
      return c.json(
        await updateProduct(productId, {
          name: b.name,
          aliases: b.aliases,
          slug: b.slug,
          teamSlug: b.team_slug,
        }),
      );
    },
  )
  .delete("/products/:slug", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(await deleteProduct(productId));
  })
  .get("/source-connections", async (c) => {
    const ctx = await callerScope(c);
    const rows = await listSourceConnections();
    return c.json(
      await Promise.all(
        rows.map(async (r) => ({
          ...r,
          token_source: await tokenSource(r.source_type, r.slug, ctx),
        })),
      ),
    );
  })
  .post(
    "/source-connections",
    requireAdmin,
    zValidator("json", sourceConnSchema),
    async (c) => {
      const { token, ...conn } = c.req.valid("json");
      if (token && !secretsEnabled())
        throw badInput(
          "credential storage is disabled — set TACHY_SECRET_KEY on the server to store API tokens",
        );
      const actor = token ? await requireCaller(c) : null;
      const row = await addSourceConnection(conn);
      if (token && actor)
        await setCredential(
          actor,
          "global",
          undefined,
          sourceCredentialName(conn.sourceType, conn.slug),
          token,
        );
      return c.json(row);
    },
  )
  .delete("/source-connections/:slug", requireAdmin, async (c) => {
    return c.json(await deleteSourceConnection(c.req.param("slug")!));
  })
  // Cheapest authenticated call the remote API offers, using the caller's own
  // token. Doubles as discovery of the groups worth registering as projects.
  .post("/source-connections/:slug/test", async (c) => {
    const slug = c.req.param("slug");
    try {
      const { source } = await resolveSource(slug, await callerScope(c));
      if (!source.verify)
        return c.json({
          ok: false,
          error: "this source type has no test call",
        });
      const probe = await source.verify();
      return c.json({ ok: true, ...probe });
    } catch (e) {
      return c.json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
