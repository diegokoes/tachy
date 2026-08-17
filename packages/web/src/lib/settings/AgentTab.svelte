<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Badge, Button, Note, Panel, Select } from "../tui";

  type PrefSource = "user" | "team" | "db" | "env" | "default";
  type Pref<T> = { value: T; source: PrefSource };
  type Prefs = {
    agent_provider: Pref<"claude" | "copilot">;
    agent_model: Pref<string>;
    agent_effort: Pref<string>;
  };

  let prefs = $state<Prefs | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let modelDraft = $state("");

  const label = (s: PrefSource) => (s === "db" ? "global" : s);
  const tone = (s: PrefSource): "accent" | "muted" =>
    s === "user" ? "accent" : "muted";

  async function load() {
    loading = true;
    error = null;
    try {
      prefs = await api.get<Prefs>("/me/preferences");
      modelDraft =
        prefs.agent_model.source === "user" ? prefs.agent_model.value : "";
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function setPref(key: string, value: unknown) {
    error = null;
    try {
      await api.put(`/me/preferences/${key}`, { value });
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function resetPref(key: string) {
    error = null;
    try {
      await api.delete(`/me/preferences/${key}`);
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  onMount(load);
</script>

<Panel title="agent">
  <p class="lede">
    Personal overrides. Anything you leave unset falls back team → global →
    server environment → built-in default.
  </p>

  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if loading && !prefs}<p class="muted">loading…</p>{/if}

  {#if prefs}
    <div class="rows">
      <div class="row">
        <span class="k">provider</span>
        <span class="v">
          <Select
            value={prefs.agent_provider.value}
            options={[
              { value: "claude", label: "claude (Anthropic)" },
              { value: "copilot", label: "copilot (GitHub)" },
            ]}
            onchange={(v) => setPref("agent_provider", v)}
          />
        </span>
        <span class="s">
          <Badge tone={tone(prefs.agent_provider.source)}
            >{label(prefs.agent_provider.source)}</Badge
          >
        </span>
        <span class="a">
          {#if prefs.agent_provider.source === "user"}
            <Button
              variant="ghost"
              size="sm"
              onclick={() => resetPref("agent_provider")}>reset</Button
            >
          {/if}
        </span>
      </div>

      <div class="row">
        <span class="k">model</span>
        <span class="v">
          <input bind:value={modelDraft} placeholder={prefs.agent_model.value} />
          {#if modelDraft.trim() && modelDraft.trim() !== prefs.agent_model.value}
            <Button
              size="sm"
              onclick={() => setPref("agent_model", modelDraft.trim())}
              >apply</Button
            >
          {/if}
        </span>
        <span class="s">
          <Badge tone={tone(prefs.agent_model.source)}
            >{label(prefs.agent_model.source)}</Badge
          >
        </span>
        <span class="a">
          {#if prefs.agent_model.source === "user"}
            <Button
              variant="ghost"
              size="sm"
              onclick={() => resetPref("agent_model")}>reset</Button
            >
          {/if}
        </span>
      </div>

      <div class="row">
        <span class="k">effort</span>
        <span class="v">
          <Select
            value={prefs.agent_effort.value}
            options={["low", "medium", "high", "xhigh", "max"]}
            onchange={(v) => setPref("agent_effort", v)}
          />
        </span>
        <span class="s">
          <Badge tone={tone(prefs.agent_effort.source)}
            >{label(prefs.agent_effort.source)}</Badge
          >
        </span>
        <span class="a">
          {#if prefs.agent_effort.source === "user"}
            <Button
              variant="ghost"
              size="sm"
              onclick={() => resetPref("agent_effort")}>reset</Button
            >
          {/if}
        </span>
      </div>
    </div>
  {/if}
</Panel>

<style>
  .lede {
    margin: 0 0 var(--pad-4);
    font-size: var(--fs-sm);
    color: var(--muted);
    max-width: 62ch;
  }
  .muted {
    color: var(--muted);
  }

  /* A fixed grid, so a source badge changing width never moves the controls. */
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .row {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr) 6rem 6rem;
    gap: var(--gap);
    align-items: center;
    min-height: var(--row-h);
  }
  .k {
    font-size: var(--fs-sm);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }
  .v {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  .v input {
    flex: 1;
    min-width: 0;
  }
  .a {
    text-align: right;
  }
</style>
