<script lang="ts">
  import { PROVIDER_OPTIONS } from "./vocab";
  import { api } from "./api";
  import {
    AGENT_EFFORTS,
    MIN_PASSWORD_LENGTH,
    OAUTH_PREFIX,
  } from "@tachy/contract";
  import type { AgentProvider } from "@tachy/contract";
  import { csv } from "./admin/shared";
  import { initSession } from "./session.svelte";
  import { errText } from "./resource.svelte";
  import { slugify } from "./slug";
  import AuthShell from "./AuthShell.svelte";
  import TypeLine from "./TypeLine.svelte";
  import { Actions, Button, Checkbox, Field, Meter, Note, Panel, Select } from "./tui";

  let { onDone, onSkip }: { onDone: () => void; onSkip: () => void } = $props();

  const NAV_ICON = "1.5em";

  const STEPS = ["account", "workspace", "agent", "done"] as const;
  let step = $state(0);
  let attempted = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  let profile = $state<"support" | "engineering">("support");
  let email = $state("");
  let displayName = $state("");
  let password = $state("");
  let password2 = $state("");
  let orgName = $state("");
  let teamName = $state("");
  // `id` exists only to key the {#each}: the rows have no identity of their own
  // until they are named, and splicing one shifts every index after it.
  let nextProductId = 1;
  let products = $state<{ id: number; name: string }[]>([
    { id: nextProductId++, name: "" },
  ]);
  let redaction = $state(false);
  let agentProvider = $state<AgentProvider>("claude");
  let agentKey = $state("");
  let agentModel = $state("claude-sonnet-5");
  const agentKeyIsOAuth = $derived(
    agentProvider === "claude" && agentKey.startsWith(OAUTH_PREFIX),
  );
  let agentEffort = $state("medium");
  let allowedModels = $state("");

  const WIZ_TERMS = {
    support: { team: "team", product: "product", products: "products" },
    engineering: {
      team: "organization",
      product: "repository",
      products: "repositories",
    },
  } as const;
  const wt = $derived(WIZ_TERMS[profile]);

  const namedProducts = $derived(products.filter((p) => p.name.trim()));

  // Fields only go red once the user has tried to advance.
  const emailErr = $derived(
    (email.length > 0 ? !/\S+@\S+\.\S+/.test(email) : attempted)
      ? "a valid email address"
      : null,
  );
  const passwordErr = $derived(
    (password.length > 0 ? password.length < MIN_PASSWORD_LENGTH : attempted)
      ? `at least ${MIN_PASSWORD_LENGTH} characters`
      : null,
  );
  const matchErr = $derived(
    (password2.length > 0 ? password !== password2 : attempted)
      ? "passwords must match"
      : null,
  );
  const accountValid = $derived(
    /\S+@\S+\.\S+/.test(email) &&
      password.length >= MIN_PASSWORD_LENGTH &&
      password === password2,
  );

  function next() {
    error = null;
    if (STEPS[step] === "account" && !accountValid) {
      attempted = true;
      return;
    }
    attempted = false;
    if (STEPS[step] === "agent") return finish();
    step = Math.min(step + 1, STEPS.length - 1);
  }

  function back() {
    error = null;
    attempted = false;
    step = Math.max(0, step - 1);
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
          agent_provider: agentProvider,
          agent_model: agentModel.trim() || "claude-sonnet-5",
          agent_effort: agentEffort,
          ...(allowedModels.trim()
            ? { allowed_models: csv(allowedModels) }
            : {}),
        },
      };
      if (agentKey.trim()) body.agent_key = agentKey.trim();
      if (teamName.trim()) {
        body.team = { slug: slugify(teamName), name: teamName.trim() };
        if (namedProducts.length)
          body.products = namedProducts.map((p) => ({
            slug: slugify(p.name),
            name: p.name.trim(),
          }));
      }
      await api.post("/setup", body);
      step = STEPS.length - 1;
      await initSession();
      onDone();
    } catch (err) {
      error = errText(err);
    } finally {
      busy = false;
    }
  }
</script>

<AuthShell>
  <div class="wiz">
    <Panel title="setup">
      {#snippet meta()}
        <span class="prog">
          <Meter value={(step + 1) / STEPS.length} width={6} />
          {step + 1}/{STEPS.length}
        </span>
      {/snippet}

      <div class="body">
        {#if STEPS[step] === "account"}
          <h2>Your admin account</h2>
          <div class="grid">
            <Field label="email" required error={emailErr}>
              <input type="email" autocomplete="username" bind:value={email} />
            </Field>
            <Field label="display name">
              <input bind:value={displayName} />
            </Field>
            <Field label="password" required error={passwordErr}>
              <input
                type="password"
                autocomplete="new-password"
                bind:value={password}
              />
            </Field>
            <Field label="repeat password" required error={matchErr}>
              <input
                type="password"
                autocomplete="new-password"
                bind:value={password2}
              />
            </Field>
          </div>
        {:else if STEPS[step] === "workspace"}
          <h2>Your workspace</h2>
          <div class="cards">
            <button
              class="card"
              class:on={profile === "support"}
              onclick={() => (profile = "support")}
            >
              <span class="ct">support</span>
              <span class="cd">tickets, customers, environments</span>
            </button>
            <button
              class="card"
              class:on={profile === "engineering"}
              onclick={() => (profile = "engineering")}
            >
              <span class="ct">engineering</span>
              <span class="cd">repositories, organizations</span>
            </button>
          </div>

          <div class="grid">
            <Field label="organization">
              <input bind:value={orgName} />
            </Field>
            <Field
              label={wt.team}
              info={teamName
                ? `Its machine id will be ${slugify(teamName)}.`
                : undefined}
            >
              <input bind:value={teamName} />
            </Field>
          </div>

          <div class="list">
            <span class="ll">{wt.products}</span>
            <!-- Keyed: the list is spliced from the middle, and binding by
                 index into an unkeyed block shifts values under the cursor of
                 whoever is typing in a later row. -->
            {#each products as p, i (p.id)}
              <div class="prow">
                <input
                  bind:value={products[i].name}
                  disabled={!teamName.trim()}
                  placeholder={i === 0 ? `first ${wt.product}` : ""}
                />
                <span class="slug">{p.name ? slugify(p.name) : ""}</span>
                {#if products.length > 1}
                  <Button
                    variant="ghost"
                    tone="danger"
                    square
                    icon="cancel"
                    aria-label="remove"
                    onclick={() => products.splice(i, 1)}
                  />
                {/if}
              </div>
            {/each}
            <div class="addrow">
              <Button
                variant="ghost"
                tone="ok"
                square
                icon="plus"
                iconSize={NAV_ICON}
                title={`add another ${wt.product}`}
                aria-label={`add another ${wt.product}`}
                disabled={!teamName.trim()}
                onclick={() => products.push({ id: nextProductId++, name: "" })}
              />
            </div>
          </div>
        {:else if STEPS[step] === "agent"}
          <h2>The agent</h2>
          <div class="grid">
            <Field label="provider">
              <Select
                bind:value={agentProvider}
                options={PROVIDER_OPTIONS}
              />
            </Field>
            <Field label="model">
              <input bind:value={agentModel} />
            </Field>
            <Field
              label="api key or token"
              info={agentProvider === "claude"
                ? "An API key from console.anthropic.com, or a subscription token from 'claude setup-token'. Stored encrypted."
                : "Stored encrypted."}
            >
              <input type="password" autocomplete="off" bind:value={agentKey} />
            </Field>
            {#if agentKeyIsOAuth}
              <Note tone="accent">
                Recognised as a Claude <strong>subscription token</strong> — saved as the
                organisation-wide default. Chats will run on that account's usage limits
                until individual users add their own under Settings › Keys.
              </Note>
            {/if}
            <Field label="effort">
              <Select
                bind:value={agentEffort}
                options={[...AGENT_EFFORTS]}
              />
            </Field>
          </div>
          <label class="check">
            <Checkbox bind:checked={redaction} ariaLabel="scrub emails, secrets and names before they reach the model" />
            <span>scrub emails, secrets and names before they reach the model</span>
          </label>
        {:else}
          <h2>Ready</h2>
          <p class="done"><TypeLine text="tachy is set up. Opening…" /></p>
        {/if}
      </div>

      {#if error}<Note tone="danger">{error}</Note>{/if}
      {#if attempted && !accountValid}
        <Note tone="danger">fix the highlighted fields to continue</Note>
      {/if}

      {#if STEPS[step] !== "done"}
        <Actions
          iconOnly
          iconSize={NAV_ICON}
          back={step > 0 ? { label: "back", onclick: back } : undefined}
          primary={{
            label: STEPS[step] === "agent" ? "finish" : "next",
            icon: STEPS[step] === "agent" ? ("save" as const) : ("next" as const),
            onclick: next,
            busy,
          }}
        />
      {/if}
    </Panel>

    {#if step === 0}
      <button class="skip" onclick={onSkip}>skip (localhost dev)</button>
    {/if}
  </div>
</AuthShell>

<style>
  .wiz {
    width: min(44rem, 100%);
  }

  /* Pinned so the panel never resizes between steps. */
  .body {
    min-height: 17rem;
  }

  h2 {
    margin: 0 0 var(--pad-4);
    font-size: var(--fs-lg);
    font-weight: 500;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--gap);
  }

  .prog {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }

  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap);
    margin-bottom: var(--pad-4);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--pad-3);
  }
  .card.on {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .ct {
    color: var(--accent);
  }
  .cd {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .list {
    margin-top: var(--pad-3);
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .ll {
    font-size: var(--fs-sm);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }
  .prow {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .prow input {
    flex: 1;
    min-width: 0;
  }
  .addrow {
    display: flex;
    justify-content: center;
  }
  .slug {
    min-width: 9rem;
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin-top: var(--pad-3);
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .done {
    color: var(--muted);
  }

  .skip {
    display: block;
    margin: var(--pad-3) auto 0;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
