<script lang="ts">
  // First-run wizard: creates the admin account and the DB-backed runtime
  // settings that used to be env flags. Secrets (DB URL, tokens, OIDC) stay in
  // .env — the final step says so. Skipping keeps the instance in open mode.
  import TypeLine from "./TypeLine.svelte";
  import { initSession } from "./session.svelte";

  let { onDone, onSkip }: { onDone: () => void; onSkip: () => void } = $props();

  const STEPS = ["welcome", "admin", "workspace", "compliance", "agent", "review"] as const;
  let step = $state(0);
  let error = $state<string | null>(null);
  let busy = $state(false);

  // step state
  let email = $state("");
  let displayName = $state("");
  let password = $state("");
  let password2 = $state("");
  let orgName = $state("");
  let teamName = $state("");
  let productName = $state("");
  let redaction = $state(false);
  let agentModel = $state("claude-sonnet-5");
  let agentEffort = $state("medium");
  let allowedModels = $state("");

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const adminValid = $derived(
    /\S+@\S+\.\S+/.test(email) && password.length >= 10 && password === password2,
  );

  function next() {
    error = null;
    if (STEPS[step] === "admin" && !adminValid) {
      error = password !== password2
        ? "passwords do not match"
        : password.length < 10
          ? "password must be at least 10 characters"
          : "enter a valid email";
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
        if (productName.trim()) body.product = { slug: slugify(productName), name: productName.trim() };
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

    {:else if STEPS[step] === "admin"}
      <div class="body">
        <h3>Admin account</h3>
        <p class="muted">Signs in with email + password. More users (and roles) can be added later in Admin.</p>
        <label><span>email</span><input type="email" bind:value={email} autocomplete="username" /></label>
        <label><span>display name (optional)</span><input bind:value={displayName} /></label>
        <label><span>password (min 10 chars)</span><input type="password" bind:value={password} autocomplete="new-password" /></label>
        <label><span>repeat password</span><input type="password" bind:value={password2} autocomplete="new-password" /></label>
      </div>

    {:else if STEPS[step] === "workspace"}
      <div class="body">
        <h3>Workspace</h3>
        <p class="muted">All optional: teams and products can also be added later (or by the agent, with approval).</p>
        <label><span>organization name</span><input bind:value={orgName} placeholder="e.g. osapiens" /></label>
        <label><span>first team</span><input bind:value={teamName} placeholder="e.g. Hardware Integrations" /></label>
        <label><span>first product {teamName.trim() ? "" : "(needs a team)"}</span>
          <input bind:value={productName} disabled={!teamName.trim()} placeholder="e.g. Line Controller" />
        </label>
        {#if teamName.trim()}<p class="hint">slug: <code>{slugify(teamName)}</code>{#if productName.trim()} / <code>{slugify(productName)}</code>{/if}</p>{/if}
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
          <select bind:value={agentEffort}>
            {#each ["low", "medium", "high", "xhigh", "max"] as e}<option value={e}>{e}</option>{/each}
          </select>
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
            <tr><td>admin</td><td>{email}{displayName.trim() ? ` (${displayName})` : ""}</td></tr>
            <tr><td>organization</td><td>{orgName.trim() || "-"}</td></tr>
            <tr><td>team / product</td><td>{teamName.trim() ? slugify(teamName) : "-"}{productName.trim() ? ` / ${slugify(productName)}` : ""}</td></tr>
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
  .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
  .actions .ghost { border-color: transparent; color: var(--muted); }
  .actions .ghost:hover { color: var(--text); }
  .primary { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .review { border-collapse: collapse; }
  .review td { border: 1px solid var(--border); padding: 0.35rem 0.7rem; font-size: 0.9rem; }
  .review td:first-child { color: var(--muted); }
  .hint { margin: 0; font-size: 0.8rem; color: var(--muted); }
  .error { color: var(--danger); margin: 0; font-size: 0.88rem; }
  .muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
  code { background: var(--accent-dim); border-radius: 3px; padding: 0 0.3em; font-size: 0.92em; }
</style>
