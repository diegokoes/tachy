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
  type Setting<T> = { value: T; source: "db" | "env" | "default" };
  type SystemInfo = {
    settings: {
      redaction_global: Setting<boolean>;
      agent_model: Setting<string>;
      agent_effort: Setting<string>;
      allowed_models: Setting<string[]>;
      org_name: Setting<string | null>;
    };
    env: {
      auth_mode: string; port: number; user_email: string | null;
      oidc_configured: boolean; api_token_set: boolean; session_secret_set: boolean;
      anthropic_api_key_set: boolean; upload_dir: string | null;
    };
  };
  type UserRow = {
    id: string; email: string; display_name: string | null;
    role: "admin" | "member"; disabled: boolean; has_password: boolean; created_at: string;
  };
  type Member = { user_id: string; email: string; display_name: string | null; team_role: string };

  const tabs = [
    { key: "teams", label: "Teams" },
    { key: "products", label: "Products" },
    { key: "components", label: "Components" },
    { key: "labels", label: "Labels" },
    { key: "customers", label: "Customers" },
    { key: "patterns", label: "Resolution patterns" },
    { key: "sources", label: "Sources" },
    { key: "users", label: "Users" },
    { key: "system", label: "System" },
  ] as const;
  type Tab = (typeof tabs)[number]["key"];

  const EXPLAINERS: Record<Tab, string> = {
    teams: "Top of the hierarchy. A team owns one or more products - one support team covering several apps is the normal case.",
    products: "What you support. Everything else hangs off a product: its components, labels, knowledge entries, and source mappings.",
    components: "Per-product architecture glossary the agent maps ticket areas onto. Knowledge entries anchor to a component; the entry's product_area path is derived from this hierarchy.",
    labels: "Per-product advisory tag vocabulary. Tags stay free-form, but the agent reuses these slugs instead of inventing near-duplicates.",
    customers: "Companies that report tickets, auto-matched onto work items by email domain or alias. Deliberately cross-product: one customer can use several products.",
    patterns: "Controlled vocabulary for HOW issues get resolved (rollback, config-fix…). The agent may only pick existing slugs - it never invents one.",
    sources: "Where tickets come from. One connection per system (a Freshdesk domain, a GitHub repo…); the group→product map routes each connection's groups/repos onto your products - that's how many sources feed one catalog.",
    users: "Who can sign in, and what they may do. Admins manage users, org structure and settings; members use the app. Team membership links users to the teams they work in.",
    system: "Runtime settings live in the database (editable here, admin only); env shows the value still winning as a fallback. Secrets and bootstrap config stay in .env - only whether they're set is shown.",
  };

  const TIP = {
    slug: "Stable lowercase machine id (no spaces) used in filters, URLs and by the agent. Don't rename once things reference it.",
    aliases: "Alternative names that resolve to the same record (lc, LC, \"line controller\"). Keeps naming variants from becoming duplicates.",
    parent: "Parent component in the hierarchy - product_area paths (Product / Parent / Component) are derived from it.",
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
  let users = $state<UserRow[]>([]);
  let membersTeam = $state(""); // team scope for the membership editor
  let members = $state<Member[]>([]);
  let pwFor = $state<string | null>(null); // user id with the set-password input open
  let pwValue = $state("");
  // Editable drafts for the text settings; applied per-row on demand.
  let draft = $state<Record<string, string>>({});

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
        syncDraft();
      } else if (active === "users") {
        [users, teams] = await Promise.all([api.get<UserRow[]>("/users"), api.get<Team[]>("/teams")]);
        if (!membersTeam && teams.length) membersTeam = teams[0].slug;
        members = membersTeam ? await api.get(`/users/team-members/${membersTeam}`) : [];
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
      } else if (active === "users") {
        await api.post("/users", {
          email: form.email,
          display_name: form.name || undefined,
          password: form.password || undefined,
          role: form.role || "member",
        });
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

  function syncDraft() {
    if (!system) return;
    draft = {
      agent_model: system.settings.agent_model.value,
      allowed_models: system.settings.allowed_models.value.join(", "),
      org_name: system.settings.org_name.value ?? "",
    };
  }

  async function saveSetting(key: string, value: unknown) {
    error = null;
    try {
      const res = await api.put<{ settings: SystemInfo["settings"] }>(`/settings/${key}`, { value });
      if (system) system = { ...system, settings: res.settings };
      syncDraft();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function patchUser(id: string, patch: Record<string, unknown>) {
    error = null;
    try {
      await api.patch(`/users/${id}`, patch);
      users = await api.get("/users");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      users = await api.get("/users"); // revert optimistic select/checkbox state
    }
  }

  async function setMember(email: string, role: string | null) {
    error = null;
    try {
      await api.put(`/users/team-members/${membersTeam}`, { email, role });
      members = await api.get(`/users/team-members/${membersTeam}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    void active;
    void productSlug;
    void membersTeam;
    showForm = false;
    form = {};
    pwFor = null;
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
      <th class="tip" title="Display name. The machine slug stays under the hood - it only matters when the agent or filters reference the team.">team</th>
      <th class="tip" title="Products owned by this team - managed in the Products tab">products</th>
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
        <tr><td colspan="5" class="muted">No components for this product yet - seed them from docs via Chat, or add one below.</td></tr>
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
      {#if !loading && customers.length === 0}<tr><td colspan="4" class="muted">No customers yet - they're usually auto-registered when tickets are ingested.</td></tr>{/if}
    </tbody>
  </table>
{:else if active === "patterns"}
  <table>
    <thead><tr><th class="tip" title={TIP.slug}>slug</th><th>description</th></tr></thead>
    <tbody>
      {#each patterns as r}<tr><td>{r.slug}</td><td class="muted">{r.description}</td></tr>{/each}
      {#if !loading && patterns.length === 0}
        <tr><td colspan="2" class="muted">No resolution patterns yet - this controlled vocabulary grows only on explicit request.</td></tr>
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
{:else if active === "users"}
  <table>
    <thead><tr>
      <th>email</th><th>name</th>
      <th class="tip" title="admin: manage users, org structure and settings. member: use the app.">role</th>
      <th class="tip" title="Whether email+password login is set up for this user. SSO users don't need one.">password</th>
      <th class="tip" title="Disabled users cannot sign in (their past activity stays attributed).">disabled</th>
    </tr></thead>
    <tbody>
      {#each users as u (u.id)}
        <tr class:dim={u.disabled}>
          <td>{u.email}</td>
          <td class="muted">{u.display_name ?? ""}</td>
          <td>
            <select value={u.role} onchange={(e) => patchUser(u.id, { role: (e.target as HTMLSelectElement).value })}>
              <option value="admin">admin</option>
              <option value="member">member</option>
            </select>
          </td>
          <td>
            {#if pwFor === u.id}
              <form class="pw-form" onsubmit={(e) => { e.preventDefault(); patchUser(u.id, { password: pwValue }).then(() => { pwFor = null; pwValue = ""; }); }}>
                <input type="password" placeholder="new password (min 10)" bind:value={pwValue} />
                <button type="submit" disabled={pwValue.length < 10}>set</button>
                <button type="button" onclick={() => { pwFor = null; pwValue = ""; }}>cancel</button>
              </form>
            {:else}
              <span class="muted">{u.has_password ? "set" : "none"}</span>
              <button class="mini" onclick={() => { pwFor = u.id; pwValue = ""; }}>{u.has_password ? "reset" : "set"}…</button>
            {/if}
          </td>
          <td>
            <input type="checkbox" checked={u.disabled}
              onchange={(e) => patchUser(u.id, { disabled: (e.target as HTMLInputElement).checked })} />
          </td>
        </tr>
      {/each}
      {#if !loading && users.length === 0}<tr><td colspan="5" class="muted">No users yet - run the setup wizard, or add one below.</td></tr>{/if}
    </tbody>
  </table>

  <h4>Team membership</h4>
  {#if teams.length === 0}
    <p class="muted">No teams yet - create one in the Teams tab first.</p>
  {:else}
    <div class="scope">
      <label>team
        <select bind:value={membersTeam}>
          {#each teams as t}<option value={t.slug}>{t.name}</option>{/each}
        </select>
      </label>
    </div>
    <table>
      <thead><tr><th>member</th><th class="tip" title="Free-form role within the team (lead, member, on-call…). Distinct from the global admin/member role.">team role</th><th></th></tr></thead>
      <tbody>
        {#each members as m (m.user_id)}
          <tr>
            <td>{m.email}{m.display_name ? ` (${m.display_name})` : ""}</td>
            <td class="muted">{m.team_role}</td>
            <td><button class="mini" onclick={() => setMember(m.email, null)}>remove</button></td>
          </tr>
        {/each}
        {#if members.length === 0}<tr><td colspan="3" class="muted">No members in this team yet.</td></tr>{/if}
      </tbody>
    </table>
    {#if users.length}
      <form class="add-form" onsubmit={(e) => { e.preventDefault(); if (form.member_email) setMember(form.member_email, form.member_role || "member"); }}>
        <label>user
          <select bind:value={form.member_email}>
            {#each users.filter((u) => !members.some((m) => m.email === u.email)) as u}<option value={u.email}>{u.email}</option>{/each}
          </select>
        </label>
        <input placeholder="team role (default: member)" bind:value={form.member_role} />
        <button type="submit" disabled={!form.member_email}>add to team</button>
      </form>
    {/if}
  {/if}
{:else if active === "system" && system}
  <h4>Runtime settings <span class="muted">(stored in the database - editable)</span></h4>
  <table>
    <thead><tr><th>setting</th><th>value</th>
      <th class="tip" title="db: set here. env: falling back to the environment variable. default: built-in.">source</th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="tip" title="When on, PII/secrets are scrubbed from everything sent to the LLM - all connections, pasted context and retrieved results. The database keeps raw data.">PII / secret redaction</td>
        <td>
          <label class="check">
            <input type="checkbox" checked={system.settings.redaction_global.value}
              onchange={(e) => saveSetting("redaction_global", (e.target as HTMLInputElement).checked)} />
            <span class:on={system.settings.redaction_global.value}>
              {system.settings.redaction_global.value ? "on - scrub at the LLM boundary" : "off (per-connection opt-in only)"}
            </span>
          </label>
        </td>
        <td><span class="badge src-{system.settings.redaction_global.source}">{system.settings.redaction_global.source}</span></td>
      </tr>
      <tr>
        <td>Agent model</td>
        <td class="edit-cell">
          <input bind:value={draft.agent_model} />
          {#if draft.agent_model !== system.settings.agent_model.value}
            <button class="mini" onclick={() => saveSetting("agent_model", draft.agent_model.trim())}>apply</button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.agent_model.source}">{system.settings.agent_model.source}</span></td>
      </tr>
      <tr>
        <td>Agent effort</td>
        <td>
          <select value={system.settings.agent_effort.value}
            onchange={(e) => saveSetting("agent_effort", (e.target as HTMLSelectElement).value)}>
            {#each ["low", "medium", "high", "xhigh", "max"] as e}<option value={e}>{e}</option>{/each}
          </select>
        </td>
        <td><span class="badge src-{system.settings.agent_effort.source}">{system.settings.agent_effort.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="Comma-separated; empty = unrestricted.">Model allowlist</td>
        <td class="edit-cell">
          <input bind:value={draft.allowed_models} placeholder="unrestricted" />
          {#if draft.allowed_models !== system.settings.allowed_models.value.join(", ")}
            <button class="mini" onclick={() => saveSetting("allowed_models", draft.allowed_models.split(",").map((s) => s.trim()).filter(Boolean))}>apply</button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.allowed_models.source}">{system.settings.allowed_models.source}</span></td>
      </tr>
      <tr>
        <td>Organization name</td>
        <td class="edit-cell">
          <input bind:value={draft.org_name} />
          {#if draft.org_name !== (system.settings.org_name.value ?? "") && draft.org_name.trim()}
            <button class="mini" onclick={() => saveSetting("org_name", draft.org_name.trim())}>apply</button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.org_name.source}">{system.settings.org_name.source}</span></td>
      </tr>
    </tbody>
  </table>
  <p class="muted hint">Changes apply to the next agent turn / MCP start - no restart needed for the web agent.</p>

  <h4>Environment <span class="muted">(bootstrap + secrets - read-only, set in .env)</span></h4>
  <table>
    <thead><tr><th>setting</th><th>value</th><th>env var</th></tr></thead>
    <tbody>
      <tr>
        <td>Auth</td>
        <td>{system.env.auth_mode}{system.env.auth_mode === "open" ? " (wizard/password login takes over once set up)" : ""}</td>
        <td class="muted">OIDC_* {system.env.oidc_configured ? "(set)" : "(unset)"} · TACHY_API_TOKEN {system.env.api_token_set ? "(set)" : "(unset)"}</td>
      </tr>
      <tr>
        <td>Session secret</td>
        <td>{system.env.session_secret_set ? "set" : "not set - ephemeral; sessions reset on restart"}</td>
        <td class="muted">TACHY_SESSION_SECRET</td>
      </tr>
      <tr><td>Anthropic API key</td><td>{system.env.anthropic_api_key_set ? "set" : "not set (falls back to the server's Claude Code login)"}</td><td class="muted">ANTHROPIC_API_KEY</td></tr>
      <tr><td>Attribution email (standalone MCP)</td><td>{system.env.user_email ?? "(anonymous)"}</td><td class="muted">TACHY_USER_EMAIL</td></tr>
      <tr><td>Upload dir</td><td>{system.env.upload_dir ?? "(OS tmp dir)"}</td><td class="muted">TACHY_UPLOAD_DIR</td></tr>
      <tr><td>API port</td><td>{system.env.port}</td><td class="muted">PORT</td></tr>
    </tbody>
  </table>
{/if}

{#if active !== "sources" && active !== "system"}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add {active === "patterns" ? "pattern" : active.slice(0, -1)}</button>
    {:else if active === "users"}
      <form class="add-form" onsubmit={(e) => { e.preventDefault(); add(); }}>
        <input type="email" placeholder="email" bind:value={form.email} required />
        <input placeholder="display name" bind:value={form.name} />
        <input type="password" placeholder="password (optional, min 10)" bind:value={form.password} />
        <label>role
          <select bind:value={form.role}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
        <button type="button" onclick={() => { showForm = false; form = {}; }}>Cancel</button>
      </form>
      <p class="muted hint">No password = SSO-only (or attribution-only) user; a password can be set later.</p>
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
        <p class="muted hint">Slugs are what entries anchor to - pick stable, lowercase names; use aliases for naming variants (lc, LC, line controller).</p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .tabs { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
  .tabs button.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .explainer { margin: 0 0 0.9rem; font-size: 0.82rem; line-height: 1.5; max-width: 60rem; }
  th.tip, td.tip { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
  td .on { color: var(--ok); }
  tr.dim td { opacity: 0.55; }
  .mini { font-size: 0.75rem; padding: 0.15rem 0.5rem; margin-left: 0.4rem; }
  .pw-form { display: flex; gap: 0.4rem; align-items: center; }
  .pw-form input { min-width: 11rem; }
  .edit-cell { display: flex; gap: 0.4rem; align-items: center; }
  .edit-cell input { min-width: 13rem; }
  label.check { display: flex; gap: 0.5rem; align-items: center; cursor: pointer; }
  label.check input { accent-color: var(--accent); }
  .badge {
    font-size: 0.72rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.05rem 0.55rem;
    color: var(--muted);
  }
  .badge.src-db { border-color: var(--accent); color: var(--accent); }
  .badge.src-env { border-color: var(--warn); color: var(--warn); }
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
