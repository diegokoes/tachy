<script lang="ts">
  import { api } from "./api";

  type Team = { id: string; slug: string; name: string };
  type Product = { id: string; slug: string; name: string; aliases: string[] | null; team_slug: string; team_name: string };
  type Component = { id: string; parent_id: string | null; slug: string; name: string; description: string | null; aliases: string[] | null };
  type Label = { id: string; slug: string; description: string | null };
  type Customer = { id: string; slug: string; name: string; aliases: string[] | null; notes: string | null };
  type Pattern = { slug: string; description: string };
  type Connection = { id: string; source_type: string; slug: string; base_url: string | null; config: Record<string, unknown> | null };
  type ProductMap = { id: string; source_slug: string; external_group_key: string; product_slug: string; product_name: string };
  type SystemInfo = {
    auth_mode: string; port: number; redaction_global: boolean; user_email: string | null;
    oidc_configured: boolean; api_token_set: boolean; agent_model: string | null;
    agent_effort: string | null; allowed_models: string | null; upload_dir: string | null;
    anthropic_api_key_set: boolean;
  };

  const tabs = [
    { key: "teams", label: "Teams" },
    { key: "products", label: "Products" },
    { key: "components", label: "Components" },
    { key: "labels", label: "Labels" },
    { key: "customers", label: "Customers" },
    { key: "patterns", label: "Resolution patterns" },
    { key: "sources", label: "Sources" },
    { key: "system", label: "System" },
  ] as const;
  type Tab = (typeof tabs)[number]["key"];

  const EXPLAINERS: Record<Tab, string> = {
    teams: "Top of the hierarchy. A team owns one or more products — one support team covering several apps is the normal case.",
    products: "What you support. Everything else hangs off a product: its components, labels, knowledge entries, and source mappings.",
    components: "Per-product architecture glossary the agent maps ticket areas onto. Knowledge entries anchor to a component; the entry's product_area path is derived from this hierarchy.",
    labels: "Per-product advisory tag vocabulary. Tags stay free-form, but the agent reuses these slugs instead of inventing near-duplicates.",
    customers: "Companies that report tickets, auto-matched onto work items by email domain or alias. Deliberately cross-product: one customer can use several products.",
    patterns: "Controlled vocabulary for HOW issues get resolved (rollback, config-fix…). The agent may only pick existing slugs — it never invents one.",
    sources: "Where tickets come from. One connection per system (a Freshdesk domain, a GitHub repo…); the group→product map routes each connection's groups/repos onto your products — that's how many sources feed one catalog.",
    system: "Effective deployment settings. These are environment variables (secrets, auth, cost policy — deployment concerns), so they're read-only here; change them in .env / compose and restart.",
  };

  const TIP = {
    slug: "Stable lowercase machine id (no spaces) used in filters, URLs and by the agent. Don't rename once things reference it.",
    aliases: "Alternative names that resolve to the same record (lc, LC, \"line controller\"). Keeps naming variants from becoming duplicates.",
    parent: "Parent component in the hierarchy — product_area paths (Product / Parent / Component) are derived from it.",
    team: "Owning team. One team can own many products.",
    group: "The source system's own grouping key: a Freshdesk group id, a GitHub owner/repo…",
  };

  let active = $state<Tab>("teams");
  let error = $state<string | null>(null);
  let loading = $state(false);
  let saving = $state(false);

  let teams = $state<Team[]>([]);
  let products = $state<Product[]>([]);
  let components = $state<Component[]>([]);
  let labels = $state<Label[]>([]);
  let customers = $state<Customer[]>([]);
  let patterns = $state<Pattern[]>([]);
  let connections = $state<Connection[]>([]);
  let productMaps = $state<ProductMap[]>([]);
  let system = $state<SystemInfo | null>(null);

  let productSlug = $state(""); // scope for the per-product tabs (components, labels)

  // One flat form object; each tab reads the fields it needs.
  let form = $state<Record<string, string>>({});
  let showForm = $state(false);

  const csv = (v: string | undefined) =>
    v?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  async function load() {
    loading = true;
    error = null;
    try {
      if (active === "teams") {
        [teams, products] = await Promise.all([api.get<Team[]>("/teams"), api.get<Product[]>("/products")]);
      } else if (active === "products") {
        [products, teams] = await Promise.all([api.get<Product[]>("/products"), api.get<Team[]>("/teams")]);
      }
      else if (active === "customers") customers = await api.get("/customers");
      else if (active === "patterns") patterns = await api.get("/resolution-patterns");
      else if (active === "sources") {
        connections = await api.get("/source-connections");
        productMaps = await api.get("/source-product-maps");
      } else if (active === "system") {
        system = await api.get("/system");
      } else {
        products = await api.get("/products");
        if (!productSlug && products.length) productSlug = products[0].slug;
        if (productSlug) {
          if (active === "components") components = await api.get(`/products/${productSlug}/components`);
          else labels = await api.get(`/products/${productSlug}/labels`);
        } else {
          components = [];
          labels = [];
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function add() {
    saving = true;
    error = null;
    try {
      if (active === "teams") {
        await api.post("/teams", { slug: form.slug, name: form.name });
      } else if (active === "products") {
        await api.post("/products", {
          team_slug: form.team_slug || teams[0]?.slug, slug: form.slug, name: form.name, aliases: csv(form.aliases),
        });
      } else if (active === "components") {
        await api.post(`/products/${productSlug}/components`, {
          slug: form.slug, name: form.name,
          parentSlug: form.parent || undefined, description: form.description || undefined, aliases: csv(form.aliases),
        });
      } else if (active === "labels") {
        await api.post(`/products/${productSlug}/labels`, { slug: form.slug, description: form.description || undefined });
      } else if (active === "customers") {
        await api.post("/customers", { slug: form.slug, name: form.name, aliases: csv(form.aliases), notes: form.notes || undefined });
      } else if (active === "patterns") {
        await api.post("/resolution-patterns", { slug: form.slug, description: form.description ?? "" });
      }
      form = {};
      showForm = false;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  const parentSlugOf = (c: Component) => components.find((p) => p.id === c.parent_id)?.slug ?? "";
  const productsOf = (teamSlug: string) => products.filter((p) => p.team_slug === teamSlug).map((p) => p.name);
  const aliasText = (a: string[] | null) => (a?.length ? a.join(", ") : "");
  const redactionOn = (c: Connection) =>
    ((c.config as { redaction?: { enabled?: boolean } } | null)?.redaction?.enabled) === true;

  $effect(() => {
    void active;
    void productSlug;
    showForm = false;
    form = {};
    load();
  });
</script>

<div class="tabs">
  {#each tabs as t}
    <button class:active={active === t.key} onclick={() => (active = t.key)}>{t.label}</button>
  {/each}
</div>

<p class="explainer muted">{EXPLAINERS[active]}</p>

{#if active === "components" || active === "labels"}
  <div class="scope">
    <label>product
      <select bind:value={productSlug}>
        {#each products as p}<option value={p.slug}>{p.name} ({p.team_slug})</option>{/each}
      </select>
    </label>
  </div>
{/if}

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

{#if active === "teams"}
  <table>
    <thead><tr>
      <th class="tip" title="Display name. The machine slug stays under the hood — it only matters when the agent or filters reference the team.">team</th>
      <th class="tip" title="Products owned by this team — managed in the Products tab">products</th>
    </tr></thead>
    <tbody>
      {#each teams as r}
        <tr>
          <td>{r.name}</td>
          <td class="muted">[ {productsOf(r.slug).join(", ") || "no products yet"} ]</td>
        </tr>
      {/each}
      {#if !loading && teams.length === 0}<tr><td colspan="2" class="muted">No teams yet.</td></tr>{/if}
    </tbody>
  </table>
{:else if active === "products"}
  <table>
    <thead><tr>
      <th class="tip" title={TIP.slug}>slug</th><th>name</th>
      <th class="tip" title={TIP.team}>team</th>
      <th class="tip" title={TIP.aliases}>aliases</th>
    </tr></thead>
    <tbody>
      {#each products as r}
        <tr><td>{r.slug}</td><td>{r.name}</td><td>{r.team_slug}</td><td class="muted">{aliasText(r.aliases)}</td></tr>
      {/each}
      {#if !loading && products.length === 0}<tr><td colspan="4" class="muted">No products yet.</td></tr>{/if}
    </tbody>
  </table>
{:else if active === "components"}
  <table>
    <thead><tr>
      <th class="tip" title={TIP.slug}>slug</th><th>name</th>
      <th class="tip" title={TIP.parent}>parent</th>
      <th class="tip" title={TIP.aliases}>aliases</th><th>description</th>
    </tr></thead>
    <tbody>
      {#each components as r}
        <tr>
          <td>{r.slug}</td><td>{r.name}</td><td class="muted">{parentSlugOf(r)}</td>
          <td class="muted">{aliasText(r.aliases)}</td><td class="muted">{r.description ?? ""}</td>
        </tr>
      {/each}
      {#if !loading && components.length === 0}
        <tr><td colspan="5" class="muted">No components for this product yet — seed them from docs via Chat, or add one below.</td></tr>
      {/if}
    </tbody>
  </table>
{:else if active === "labels"}
  <table>
    <thead><tr><th class="tip" title={TIP.slug}>slug</th><th>description</th></tr></thead>
    <tbody>
      {#each labels as r}<tr><td>{r.slug}</td><td class="muted">{r.description ?? ""}</td></tr>{/each}
      {#if !loading && labels.length === 0}<tr><td colspan="2" class="muted">No labels for this product yet.</td></tr>{/if}
    </tbody>
  </table>
{:else if active === "customers"}
  <table>
    <thead><tr>
      <th class="tip" title={TIP.slug}>slug</th><th>name</th>
      <th class="tip" title={TIP.aliases}>aliases</th><th>notes</th>
    </tr></thead>
    <tbody>
      {#each customers as r}
        <tr><td>{r.slug}</td><td>{r.name}</td><td class="muted">{aliasText(r.aliases)}</td><td class="muted">{r.notes ?? ""}</td></tr>
      {/each}
      {#if !loading && customers.length === 0}<tr><td colspan="4" class="muted">No customers yet — they're usually auto-registered when tickets are ingested.</td></tr>{/if}
    </tbody>
  </table>
{:else if active === "patterns"}
  <table>
    <thead><tr><th class="tip" title={TIP.slug}>slug</th><th>description</th></tr></thead>
    <tbody>
      {#each patterns as r}<tr><td>{r.slug}</td><td class="muted">{r.description}</td></tr>{/each}
      {#if !loading && patterns.length === 0}
        <tr><td colspan="2" class="muted">No resolution patterns yet — this controlled vocabulary grows only on explicit request.</td></tr>
      {/if}
    </tbody>
  </table>
{:else if active === "sources"}
  <h4>Connections</h4>
  <table>
    <thead><tr><th>slug</th><th>type</th><th>base URL</th><th>redaction</th></tr></thead>
    <tbody>
      {#each connections as r}
        <tr>
          <td>{r.slug}</td><td>{r.source_type}</td><td class="muted">{r.base_url ?? ""}</td>
          <td>{redactionOn(r) ? "on" : "off"}</td>
        </tr>
      {/each}
      {#if !loading && connections.length === 0}<tr><td colspan="4" class="muted">No source connections yet.</td></tr>{/if}
    </tbody>
  </table>
  <h4>Group → product mapping</h4>
  <table>
    <thead><tr><th>source</th><th class="tip" title={TIP.group}>external group</th><th>product</th></tr></thead>
    <tbody>
      {#each productMaps as r}
        <tr><td>{r.source_slug}</td><td>{r.external_group_key}</td><td>{r.product_name} ({r.product_slug})</td></tr>
      {/each}
      {#if !loading && productMaps.length === 0}<tr><td colspan="3" class="muted">No mappings yet.</td></tr>{/if}
    </tbody>
  </table>
  <p class="muted hint">
    Connections need an API token in the environment (<code>FRESHDESK_TOKEN_&lt;SLUG&gt;</code> /
    <code>GITHUB_TOKEN_&lt;SLUG&gt;</code>), so add them via Chat or the MCP tools rather than here.
  </p>
{:else if active === "system" && system}
  <table>
    <thead><tr><th>setting</th><th>value</th><th>env var</th></tr></thead>
    <tbody>
      <tr>
        <td>Auth mode</td>
        <td>{system.auth_mode}{system.auth_mode === "open" ? " (localhost only)" : ""}</td>
        <td class="muted">TACHY_AUTH_MODE · OIDC_* {system.oidc_configured ? "(set)" : "(unset)"} · TACHY_API_TOKEN {system.api_token_set ? "(set)" : "(unset)"}</td>
      </tr>
      <tr>
        <td>PII / secret redaction</td>
        <td class:on={system.redaction_global}>{system.redaction_global ? "forced on (all connections + retrieved results)" : "per-connection opt-in"}</td>
        <td class="muted">TACHY_REDACT</td>
      </tr>
      <tr><td>Attribution email</td><td>{system.user_email ?? "(anonymous)"}</td><td class="muted">TACHY_USER_EMAIL</td></tr>
      <tr><td>Agent model</td><td>{system.agent_model ?? "(server default)"}</td><td class="muted">TACHY_AGENT_MODEL</td></tr>
      <tr><td>Agent effort</td><td>{system.agent_effort ?? "(default: medium)"}</td><td class="muted">TACHY_AGENT_EFFORT</td></tr>
      <tr><td>Model allowlist</td><td>{system.allowed_models ?? "unrestricted"}</td><td class="muted">TACHY_ALLOWED_MODELS</td></tr>
      <tr><td>Anthropic API key</td><td>{system.anthropic_api_key_set ? "set" : "not set (falls back to the server's Claude Code login)"}</td><td class="muted">ANTHROPIC_API_KEY</td></tr>
      <tr><td>Upload dir</td><td>{system.upload_dir ?? "(OS tmp dir)"}</td><td class="muted">TACHY_UPLOAD_DIR</td></tr>
      <tr><td>API port</td><td>{system.port}</td><td class="muted">PORT</td></tr>
    </tbody>
  </table>
{/if}

{#if active !== "sources" && active !== "system"}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add {active === "patterns" ? "pattern" : active.slice(0, -1)}</button>
    {:else}
      <form class="add-form" onsubmit={(e) => { e.preventDefault(); add(); }}>
        {#if active === "products"}
          <label>team
            <select bind:value={form.team_slug}>
              {#each teams as t}<option value={t.slug}>{t.name}</option>{/each}
            </select>
          </label>
        {/if}
        <input placeholder="slug" bind:value={form.slug} required />
        {#if active === "teams" || active === "products" || active === "components" || active === "customers"}
          <input placeholder="name" bind:value={form.name} required />
        {/if}
        {#if active === "components"}
          <label>parent
            <select bind:value={form.parent}>
              <option value="">(none)</option>
              {#each components as p}<option value={p.slug}>{p.slug}</option>{/each}
            </select>
          </label>
        {/if}
        {#if active === "products" || active === "components" || active === "customers"}
          <input placeholder="aliases (comma-separated)" bind:value={form.aliases} />
        {/if}
        {#if active === "components" || active === "labels" || active === "patterns"}
          <input placeholder="description" bind:value={form.description} required={active === "patterns"} />
        {/if}
        {#if active === "customers"}
          <input placeholder="notes" bind:value={form.notes} />
        {/if}
        <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
        <button type="button" onclick={() => { showForm = false; form = {}; }}>Cancel</button>
      </form>
      {#if active === "components"}
        <p class="muted hint">Slugs are what entries anchor to — pick stable, lowercase names; use aliases for naming variants (lc, LC, line controller).</p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .tabs { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
  .tabs button.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .explainer { margin: 0 0 0.9rem; font-size: 0.82rem; line-height: 1.5; max-width: 60rem; }
  th.tip { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
  td.on { color: var(--ok); }
  .scope { display: flex; align-items: baseline; gap: 0.9rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .scope label { display: flex; gap: 0.5rem; align-items: baseline; color: var(--muted); font-size: 0.85rem; }
  .hint { font-size: 0.8rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-bottom: 0.75rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; }
  h4 { margin: 0.75rem 0 0.4rem; font-size: 0.85rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .add-area { margin-top: 0.5rem; }
  .add-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .add-form label { display: flex; gap: 0.4rem; align-items: center; color: var(--muted); font-size: 0.85rem; }
  .add-form input { min-width: 9rem; }
  code { font-size: 0.85em; }
  .muted { color: var(--muted); }
  .error { color: var(--danger); }
</style>
