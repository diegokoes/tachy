<script lang="ts">
  
  
  
  import TypeLine from "./TypeLine.svelte";
  import AsciiSelect from "./AsciiSelect.svelte";
  import { initSession } from "./session.svelte";

  let { onDone, onSkip }: { onDone: () => void; onSkip: () => void } = $props();

  const STEPS = ["welcome", "usage", "admin", "workspace", "compliance", "agent", "review"] as const;
  let step = $state(0);
  let error = $state<string | null>(null);
  let busy = $state(false);

  
  let profile = $state<"support" | "engineering">("support");
  let email = $state("");
  let displayName = $state("");
  let password = $state("");
  let password2 = $state("");
  let orgName = $state("");
  let teamName = $state("");
  let products = $state<{ name: string }[]>([{ name: "" }]);
  let redaction = $state(false);
  let agentModel = $state("claude-sonnet-5");
  let agentEffort = $state("medium");
  let allowedModels = $state("");

  
  
  const WIZ_TERMS = {
    support: { team: "team", product: "product", products: "products" },
    engineering: { team: "organization", product: "repository", products: "repositories" },
  } as const;
  const wt = $derived(WIZ_TERMS[profile]);

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const namedProducts = $derived(products.filter((p) => p.name.trim()));

  
  const emailBad = $derived(email.length > 0 && !/\S+@\S+\.\S+/.test(email));
  const passwordBad = $derived(password.length > 0 && password.length < 10);
  const matchBad = $derived(password2.length > 0 && password !== password2);
  const adminValid = $derived(
    /\S+@\S+\.\S+/.test(email) && password.length >= 10 && password === password2,
  );

  function next() {
    error = null;
    if (STEPS[step] === "admin" && !adminValid) {
      error = "fix the highlighted fields to continue";
      return;
    }
    step = Math.min(step + 1, STEPS.length - 1);
  }

  async function finish() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        password,
        ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        ...(orgName.trim() ? { org_name: orgName.trim() } : {}),
        settings: {
          deployment_profile: profile,
          redaction_global: redaction,
          agent_model: agentModel.trim() || "claude-sonnet-5",
          agent_effort: agentEffort,
          ...(allowedModels.trim()
            ? { allowed_models: allowedModels.split(",").map((s) => s.trim()).filter(Boolean) }
            : {}),
        },
      };
      if (teamName.trim()) {
        body.team = { slug: slugify(teamName), name: teamName.trim() };
        if (namedProducts.length)
          body.products = namedProducts.map((p) => ({ slug: slugify(p.name), name: p.name.trim() }));
      }
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `setup failed (${res.status})`);
      await initSession();
      onDone();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="wizard-wrap">
  <div class="wizard">
    <div class="head">
      <span class="wordmark">tachy</span>
      <span class="progress">[{step + 1}/{STEPS.length}] {"█".repeat(step + 1)}{"░".repeat(STEPS.length - step - 1)}</span>
    </div>

    {#if STEPS[step] === "welcome"}
      <div class="body">
        <TypeLine text="First run detected. Let's set this instance up." />
        <div class="actions">
          <button class="primary" onclick={next}>begin setup →</button>
          <button class="ghost" onclick={onSkip}>skip (localhost dev)</button>
        </div>
      </div>

    {:else if STEPS[step] === "usage"}
      <div class="body">
        <h3>How will you use tachy?</h3>
        <p class="muted">Display terminology only - the data model and the agent are identical either way. Changeable later in Admin › System.</p>
        <div class="cards">
          <button class="card" class:selected={profile === "support"} onclick={() => (profile = "support")}>
            <span class="card-title">{profile === "support" ? "›" : " "} Support / business</span>
            <span class="card-desc">Tickets, customers, products. Knowledge from a helpdesk (Freshdesk…).</span>
          </button>
          <button class="card" class:selected={profile === "engineering"} onclick={() => (profile = "engineering")}>
            <span class="card-title">{profile === "engineering" ? "›" : " "} Engineering / repositories</span>
            <span class="card-desc">Issues from your repos. GitHub-first; no customer dimension.</span>
          </button>
        </div>
        <p class="hint">
          {#if profile === "engineering"}
            products → <code>repositories</code> · teams → <code>organizations</code> · customer facets hidden
          {:else}
            standard vocabulary: products, teams, customers, environments
          {/if}
        </p>
      </div>

    {:else if STEPS[step] === "admin"}
      <div class="body">
        <h3>Admin account</h3>
        <p class="muted">Signs in with email + password. More users (and roles) can be added later in Admin.</p>
        <label><span>email</span><input type="email" bind:value={email} autocomplete="username" />
          {#if emailBad}<span class="field-error">not a valid email address</span>{/if}
        </label>
        <label><span>display name (optional)</span><input bind:value={displayName} /></label>
        <label><span>password (min 10 chars)</span><input type="password" bind:value={password} autocomplete="new-password" />
          {#if passwordBad}<span class="field-error">too short - at least 10 characters</span>{/if}
        </label>
        <label><span>repeat password</span><input type="password" bind:value={password2} autocomplete="new-password" />
          {#if matchBad}<span class="field-error">passwords do not match</span>{/if}
        </label>
      </div>

    {:else if STEPS[step] === "workspace"}
      <div class="body">
        <h3>Workspace</h3>
        <p class="muted">All optional: {wt.team}s and {wt.products} can also be added later (or by the agent, with approval).</p>
        <label><span>organization name</span><input bind:value={orgName} placeholder="e.g. osapiens" /></label>
        <label><span>first {wt.team}</span><input bind:value={teamName} placeholder={profile === "engineering" ? "e.g. my-github-org" : "e.g. Hardware Integrations"} /></label>
        {#each products as p, i (i)}
          <label>
            <span>{i === 0 ? `first ${wt.product} ${teamName.trim() ? "" : `(needs a ${wt.team})`}` : `${wt.product} ${i + 1}`}</span>
            <span class="prod-row">
              <input bind:value={p.name} disabled={!teamName.trim()}
                placeholder={profile === "engineering" ? "e.g. owner/repo-name" : "e.g. Line Controller"} />
              {#if products.length > 1}
                <button class="ghost mini" type="button" onclick={() => (products = products.filter((_, j) => j !== i))}>✕</button>
              {/if}
            </span>
          </label>
        {/each}
        {#if teamName.trim() && products[products.length - 1].name.trim()}
          <button class="ghost add-more" type="button" onclick={() => (products = [...products, { name: "" }])}>+ add another {wt.product}</button>
        {/if}
        {#if teamName.trim()}
          <p class="hint">slug: <code>{slugify(teamName)}</code>{#each namedProducts as p} / <code>{slugify(p.name)}</code>{/each}</p>
        {/if}
      </div>

    {:else if STEPS[step] === "compliance"}
      <div class="body">
        <h3>Compliance - PII redaction</h3>
        <p class="muted">
          When on, emails, phone numbers, credentials, card numbers and requester names are replaced
          with placeholders (<code>[EMAIL_1]</code>, <code>[SECRET_1]</code>…) in everything sent to the
          LLM - ticket content, search results, pasted context. The database keeps the raw data;
          only the model boundary is scrubbed.
        </p>
        <label class="check">
          <input type="checkbox" bind:checked={redaction} />
          <span>redact PII/secrets at the LLM boundary (recommended for customer data)</span>
        </label>
      </div>

    {:else if STEPS[step] === "agent"}
      <div class="body">
        <h3>Agent cost policy</h3>
        <p class="muted">Which Claude model the built-in chat agent uses, and how hard it thinks. Editable later in Admin › System.</p>
        <label><span>model</span><input bind:value={agentModel} /></label>
        <label><span>effort</span>
          <AsciiSelect bind:value={agentEffort} options={["low", "medium", "high", "xhigh", "max"]} />
        </label>
        <label><span>allowed models (comma-separated, empty = unrestricted)</span>
          <input bind:value={allowedModels} placeholder="claude-sonnet-5, claude-haiku-4-5" />
        </label>
      </div>

    {:else}
      <div class="body">
        <h3>Review</h3>
        <table class="review">
          <tbody>
            <tr class="section"><td colspan="2">account</td></tr>
            <tr><td>admin</td><td>{email}{displayName.trim() ? ` (${displayName})` : ""}</td></tr>
            <tr class="section"><td colspan="2">usage</td></tr>
            <tr><td>profile</td><td>{profile === "engineering" ? "engineering / repositories" : "support / business"}</td></tr>
            <tr class="section"><td colspan="2">workspace</td></tr>
            <tr><td>organization</td><td>{orgName.trim() || "-"}</td></tr>
            <tr><td>{wt.team}</td><td>{teamName.trim() ? slugify(teamName) : "-"}</td></tr>
            <tr><td>{wt.products}</td><td>{namedProducts.length ? namedProducts.map((p) => slugify(p.name)).join(", ") : "-"}</td></tr>
            <tr class="section"><td colspan="2">policies</td></tr>
            <tr><td>redaction</td><td>{redaction ? "ON - scrub PII/secrets before the LLM" : "off"}</td></tr>
            <tr><td>agent</td><td>{agentModel} · {agentEffort}{allowedModels.trim() ? ` · allowlist: ${allowedModels}` : ""}</td></tr>
          </tbody>
        </table>
        <p class="muted">
          Still in <code>.env</code> (secrets never live in the database): <code>DATABASE_URL</code>,
          <code>TACHY_API_TOKEN</code>, <code>OIDC_*</code>, <code>TACHY_SESSION_SECRET</code>,
          <code>ANTHROPIC_API_KEY</code>, source tokens. If this instance should accept remote
          connections, restart it after finishing.
        </p>
      </div>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    {#if STEPS[step] !== "welcome"}
      <div class="actions">
        <button class="ghost" onclick={() => { error = null; step = Math.max(0, step - 1); }}>← back</button>
        {#if STEPS[step] === "review"}
          <button class="primary" onclick={finish} disabled={busy}>{busy ? "setting up…" : "finish setup"}</button>
        {:else}
          <button class="primary" onclick={next}>next →</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .wizard-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .wizard {
    width: min(38rem, 100%);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 1.6rem 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .wordmark { color: var(--accent); font-size: 1.4rem; letter-spacing: 0.04em; }
  .progress { color: var(--muted); font-size: 0.85rem; letter-spacing: 0.1em; }
  .body { display: flex; flex-direction: column; gap: 0.75rem; }
  h3 { margin: 0; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.06em; }
  label { display: flex; flex-direction: column; gap: 0.3rem; }
  label span { font-size: 0.8rem; color: var(--muted); }
  label.check { flex-direction: row; align-items: center; gap: 0.6rem; }
  label.check span { font-size: 0.9rem; color: var(--text); }
  .check input { accent-color: var(--accent); width: 1.05rem; height: 1.05rem; }
  .field-error { color: var(--danger); font-size: 0.78rem; }
  .cards { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .card {
    flex: 1;
    min-width: 14rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    text-align: left;
    padding: 0.75rem 0.9rem;
    background: var(--panel);
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .card.selected { border-color: var(--accent); background: var(--accent-dim); }
  .card-title { color: var(--text); font-weight: 500; }
  .card.selected .card-title { color: var(--accent); }
  .card-desc { font-size: 0.8rem; color: var(--muted); line-height: 1.4; }
  .prod-row { display: flex; gap: 0.4rem; align-items: center; }
  .prod-row input { flex: 1; }
  .mini { font-size: 0.75rem; padding: 0.15rem 0.45rem; }
  .add-more { align-self: flex-start; font-size: 0.82rem; }
  .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
  .actions .ghost, .ghost { border-color: transparent; color: var(--muted); }
  .actions .ghost:hover, .ghost:hover { color: var(--text); }
  .primary { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .review { border-collapse: collapse; }
  .review td { border: 1px solid var(--border); padding: 0.35rem 0.7rem; font-size: 0.9rem; }
  .review td:first-child { color: var(--muted); }
  .review tr.section td {
    border: none;
    padding-top: 0.6rem;
    color: var(--accent);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .hint { margin: 0; font-size: 0.8rem; color: var(--muted); }
  .error { color: var(--danger); margin: 0; font-size: 0.88rem; }
  .muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
  code { background: var(--accent-dim); border-radius: 3px; padding: 0 0.3em; font-size: 0.92em; }
</style>
