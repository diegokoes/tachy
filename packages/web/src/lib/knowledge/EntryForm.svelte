<script lang="ts">
  import type { Snippet } from "svelte";
  import { Button, Checkbox } from "../tui";
  import { onMount, tick, untrack } from "svelte";
  import { gsap } from "../gsap";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import type { KnowledgeRow, NamedRow } from "../types";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { t } from "../terms";
  import { csv } from "../admin/shared";
  import { componentOptions } from "../catalog";
  import Icon from "../tui/Icon.svelte";

  let {
    mode,
    initial = {},
    saving = false,
    error = null,
    onSubmit,
    onCancel,
    extra,
  }: {
    mode: "create" | "edit";
    initial?: Partial<KnowledgeRow>;
    saving?: boolean;
    error?: string | null;
    onSubmit: (payload: Record<string, unknown>) => void;
    onCancel: () => void;
    extra?: Snippet;
  } = $props();

  const SUBMIT_LABEL = $derived(mode === "create" ? "create entry" : "save changes");

  const csvJoin = (v: string[] | null | undefined) => (v ?? []).join(", ");

  const seed = untrack(() => initial);

  let issueSummary = $state(seed.issue_summary ?? "");
  let rootCause = $state(seed.root_cause ?? "");
  let resolution = $state(seed.resolution ?? "");
  let symptoms = $state(csvJoin(seed.symptoms));
  let signals = $state(csvJoin(seed.signals));
  let tags = $state(csvJoin(seed.tags));
  let confidence = $state(seed.confidence ?? "");
  let cloud = $state(seed.cloud ?? "");
  let resolutionClarity = $state(seed.resolution_clarity ?? "");
  let hiddenFix = $state(Boolean(seed.hidden_fix));
  let resolutionPattern = $state(seed.resolution_pattern ?? "");
  let affectedVersion = $state(seed.affected_version ?? "");
  let fixedVersion = $state(seed.fixed_version ?? "");
  let status = $state(seed.status ?? "approved");
  let component = $state(""); 

  let showStructured = $state(false);
  let structuredField = $state<HTMLTextAreaElement>();
  let structuredText = $state(
    seed.structured && Object.keys(seed.structured).length
      ? JSON.stringify(seed.structured, null, 2)
      : "",
  );
  let structuredError = $state<string | null>(null);

  
  let products = $state<NamedRow[]>([]);
  let components = $state<NamedRow[]>([]);
  let patterns = $state<NamedRow[]>([]);
  let environments = $state<{ cloud: string; count: number }[]>([]);
  let productSlug = $state("");

  const productOptions = $derived([
    { value: "", label: `no ${t("product")}` },
    ...products
      .filter((p) => canCurateScope({ team_slug: (p.team_slug as string) ?? null }))
      .map((p) => ({ value: p.slug as string, label: `${p.name} (${p.team_slug})` })),
  ]);

  async function loadComponents(slug: string) {
    components = slug ? await api.get<NamedRow[]>(`/products/${slug}/components`) : [];
    if (component && !components.some((c) => c.slug === component)) component = "";
    if (!component && initial.component_id) {
      component = (components.find((c) => c.id === initial.component_id)?.slug as string) ?? "";
    }
  }

  onMount(async () => {
    try {
      const [prods, pats, envs] = await Promise.all([
        api.get<NamedRow[]>("/products"),
        api.get<NamedRow[]>("/resolution-patterns"),
        api.get<{ cloud: string; count: number }[]>("/knowledge/environments"),
      ]);
      products = prods;
      patterns = pats;
      environments = envs;
      if (mode === "edit" && initial.product_id) {
        productSlug = (prods.find((p) => p.id === initial.product_id)?.slug as string) ?? "";
      }
      if (productSlug) await loadComponents(productSlug);
    } catch {
    }
  });

  function buildPayload(): Record<string, unknown> | null {
    structuredError = null;
    let structured: Record<string, unknown> | undefined;
    if (structuredText.trim()) {
      try {
        structured = JSON.parse(structuredText);
      } catch (e) {
        structuredError = `invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
        return null;
      }
    }
    const text = (v: string) => (v.trim() ? v.trim() : mode === "edit" ? null : undefined);
    const payload: Record<string, unknown> = {
      issueSummary: text(issueSummary),
      rootCause: text(rootCause),
      resolution: text(resolution),
      symptoms: csv(symptoms),
      signals: csv(signals),
      tags: csv(tags),
      confidence: confidence || (mode === "edit" ? null : undefined),
      cloud: cloud.trim() || (mode === "edit" ? null : undefined),
      resolutionClarity: resolutionClarity || (mode === "edit" ? null : undefined),
      // A checkbox is always a real answer, so it is sent either way — the
      // `|| null` the other optional fields use would drop an explicit false.
      hiddenFix,
      resolutionPattern: resolutionPattern || (mode === "edit" ? null : undefined),
      affectedVersion: affectedVersion.trim() || (mode === "edit" ? null : undefined),
      fixedVersion: fixedVersion.trim() || (mode === "edit" ? null : undefined),
      component: component || (mode === "edit" ? null : undefined),
    };
    if (structured !== undefined) payload.structured = structured;
    if (mode === "create") {
      payload.status = status;
      const prod = products.find((p) => p.slug === productSlug);
      if (prod?.id) payload.productId = prod.id;
    }
    return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (payload) onSubmit(payload);
  }

  async function toggleStructured() {
    showStructured = !showStructured;
    if (!showStructured) return;
    await tick();
    if (!structuredField) return;
    resizeStructured();
    const container = structuredField.closest("main") as HTMLElement | null;
    if (!container) return;
    const target =
      container.scrollTop +
      structuredField.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      24;
    gsap.to(container, {
      scrollTop: target,
      duration: 0.82,
      ease: "power3.inOut",
      overwrite: "auto",
    });
  }

  function resizeStructured() {
    if (!structuredField) return;
    structuredField.style.height = "auto";
    structuredField.style.height = `${Math.max(structuredField.scrollHeight, 320)}px`;
  }
</script>

<form class="entry-form" onsubmit={submit}>
  <div class="formbar">
    <span class="side"></span>
    <span class="mid">{#if extra}{@render extra()}{/if}</span>
    <span class="side end">
      <Button
        variant="ghost"
        square
        icon="cancel"
        aria-label="cancel"
        title="cancel"
        disabled={saving}
        onclick={onCancel}
      />
      <Button
        variant="ghost"
        tone="accent"
        square
        icon="save"
        type="submit"
        aria-label={SUBMIT_LABEL}
        title={SUBMIT_LABEL}
        busy={saving}
      />
    </span>
  </div>
  <label class="wide">issue summary
    <input bind:value={issueSummary} required />
  </label>

  <label class="wide">root cause
    <textarea rows="3" bind:value={rootCause}></textarea>
  </label>
  <label class="wide">resolution
    <textarea rows="3" bind:value={resolution}></textarea>
  </label>

  <label class="wide">symptoms <span class="hint">comma-separated</span>
    <input bind:value={symptoms} />
  </label>
  <label class="wide">signals <span class="hint">error codes / log patterns, comma-separated</span>
    <input bind:value={signals} />
  </label>
  <label class="wide">tags <span class="hint">comma-separated</span>
    <input bind:value={tags} />
  </label>

  <div class="row">
    <label>confidence
      <AsciiSelect bind:value={confidence} options={[{ value: "", label: "unset" }, "low", "medium", "high"]} />
    </label>
    <label>clarity
      <AsciiSelect bind:value={resolutionClarity} options={[{ value: "", label: "unset" }, "clear", "partial", "unclear"]} />
    </label>
    <label>{t("cloud")}
      <input class="short" bind:value={cloud} list="entry-form-envs" />
      <datalist id="entry-form-envs">
        {#each environments as e}<option value={e.cloud}></option>{/each}
      </datalist>
    </label>
  </div>

  <div class="row">
    <label>resolution pattern
      <AsciiSelect bind:value={resolutionPattern}
        options={[{ value: "", label: "none" }, ...patterns.map((p) => p.slug as string)]} />
    </label>
    <label>affected version
      <input class="short" bind:value={affectedVersion} />
    </label>
    <label>fixed version
      <input class="short" bind:value={fixedVersion} />
    </label>
    <label class="check">
      <Checkbox bind:checked={hiddenFix} ariaLabel="hidden fix" /> hidden fix
    </label>
  </div>

  <div class="row">
    {#if mode === "create"}
      <label>{t("product")}
        <AsciiSelect bind:value={productSlug} options={productOptions}
          onchange={(v) => loadComponents(String(v))} />
      </label>
      <label>status
        <AsciiSelect bind:value={status} options={["approved", "draft"]} />
      </label>
    {/if}
    <label>component
      <AsciiSelect bind:value={component} disabled={!productSlug || components.length === 0}
        title={productSlug ? undefined : `pick a ${t("product")} first`}
        options={[{ value: "", label: "none" }, ...componentOptions(components)]} />
    </label>
  </div>

  <button
    type="button"
    class="json-toggle"
    aria-label={showStructured ? "Hide structured JSON" : "Show structured JSON"}
    title={showStructured ? "Hide structured JSON" : "Show structured JSON"}
    onclick={() => void toggleStructured()}
  >
    <Icon name="json" size="1.8rem" />
  </button>
  {#if showStructured}
    <textarea
      bind:this={structuredField}
      class="structured"
      rows="16"
      bind:value={structuredText}
      aria-label="structured JSON"
      spellcheck="false"
      oninput={resizeStructured}
    ></textarea>
    {#if structuredError}<p class="error">{structuredError}</p>{/if}
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

</form>

<style>
  /* Three tracks so the middle group stays optically centred whatever the
     actions on the right weigh. */
  .formbar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--pad-2);
    margin-bottom: var(--pad-3);
    padding-top: var(--pad-2);
    padding-bottom: var(--pad-2);
    background: var(--panel-solid);
    border-bottom: var(--panel-line);
  }
  .formbar .mid,
  .formbar .side {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .formbar .side.end { justify-content: flex-end; }
  .entry-form { display: flex; flex-direction: column; gap: 0.6rem; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.82rem; color: var(--muted); }
  label.wide { width: 100%; }
  .hint { font-size: 0.72rem; opacity: 0.8; }
  input, textarea { font: inherit; color: var(--text); }
  textarea { resize: vertical; }
  .short { max-width: 10rem; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .check { flex-direction: row; align-items: center; gap: 0.4rem; padding-bottom: 0.4rem; }
  .structured { width: 100%; min-height: 20rem; height: 20rem; box-sizing: border-box; overflow: hidden; resize: none; color: #e2e2e2; background: #000; font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.5; }
  :global(:root[data-theme="light"]) .structured { color: #000; background: #fff; }
  .json-toggle { align-self: center; display: grid; place-items: center; color: var(--text); background: transparent; border: 0; padding: 0.25rem; cursor: pointer; }
  .json-toggle:hover { color: var(--accent); }
  .error { color: var(--danger); margin: 0; }
</style>
