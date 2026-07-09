<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import type { KnowledgeRow, NamedRow } from "../types";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { t } from "../terms";

  let {
    mode,
    initial = {},
    saving = false,
    error = null,
    onSubmit,
    onCancel,
  }: {
    mode: "create" | "edit";
    initial?: Partial<KnowledgeRow>;
    saving?: boolean;
    error?: string | null;
    onSubmit: (payload: Record<string, unknown>) => void;
    onCancel: () => void;
  } = $props();

  const csvJoin = (v: string[] | null | undefined) => (v ?? []).join(", ");
  const csvSplit = (v: string) => v.split(",").map((t) => t.trim()).filter(Boolean);

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
  let learningValue = $state(seed.learning_value ?? "");
  let hiddenFix = $state(Boolean(seed.hidden_fix));
  let resolutionPattern = $state(seed.resolution_pattern ?? "");
  let affectedVersion = $state(seed.affected_version ?? "");
  let fixedVersion = $state(seed.fixed_version ?? "");
  let status = $state(seed.status ?? "approved");
  let component = $state(""); 

  let showStructured = $state(false);
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
      symptoms: csvSplit(symptoms),
      signals: csvSplit(signals),
      tags: csvSplit(tags),
      confidence: confidence || (mode === "edit" ? null : undefined),
      cloud: cloud.trim() || (mode === "edit" ? null : undefined),
      resolutionClarity: resolutionClarity || (mode === "edit" ? null : undefined),
      learningValue: learningValue || (mode === "edit" ? null : undefined),
      hiddenFix: hiddenFix || (mode === "edit" ? null : undefined),
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
</script>

<form class="entry-form" onsubmit={submit}>
  <label class="wide">issue summary
    <input bind:value={issueSummary} placeholder="One-paragraph problem summary, error codes inline" required />
  </label>

  <label class="wide">root cause
    <textarea rows="3" bind:value={rootCause} placeholder="The underlying technical cause (leave empty if unknown)"></textarea>
  </label>
  <label class="wide">resolution
    <textarea rows="3" bind:value={resolution} placeholder="What was done or should be done to fix it"></textarea>
  </label>

  <label class="wide">symptoms <span class="hint">comma-separated</span>
    <input bind:value={symptoms} placeholder="error 023 in logs, print stops mid-batch" />
  </label>
  <label class="wide">signals <span class="hint">error codes / log patterns, comma-separated</span>
    <input bind:value={signals} placeholder="023 TOO_MANY_STRINGS, HTTP 503" />
  </label>
  <label class="wide">tags <span class="hint">comma-separated</span>
    <input bind:value={tags} placeholder="lc, printing" />
  </label>

  <div class="row">
    <label>confidence
      <AsciiSelect bind:value={confidence} options={[{ value: "", label: "unset" }, "low", "medium", "high"]} />
    </label>
    <label>clarity
      <AsciiSelect bind:value={resolutionClarity} options={[{ value: "", label: "unset" }, "clear", "partial", "unclear"]} />
    </label>
    <label>learning value
      <AsciiSelect bind:value={learningValue} options={[{ value: "", label: "unset" }, "high", "medium", "low"]} />
    </label>
    <label>{t("cloud")}
      <input class="short" bind:value={cloud} placeholder="prod, qa…" list="entry-form-envs" />
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
      <input class="short" bind:value={affectedVersion} placeholder="e.g. 2.3.0" />
    </label>
    <label>fixed version
      <input class="short" bind:value={fixedVersion} placeholder="e.g. 2.4.0" />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={hiddenFix} /> hidden fix
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
        options={[{ value: "", label: "none" }, ...components.map((c) => c.slug as string)]} />
    </label>
  </div>

  <button type="button" class="mini" onclick={() => (showStructured = !showStructured)}>
    {showStructured ? "▾" : "▸"} advanced: structured JSON
  </button>
  {#if showStructured}
    <textarea class="structured" rows="8" bind:value={structuredText}
      placeholder={'{ "investigation_steps": ["…"], "related_links": ["https://…"] }'}></textarea>
    {#if structuredError}<p class="error">{structuredError}</p>{/if}
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

  <div class="actions">
    <button type="submit" disabled={saving}>{saving ? "saving…" : mode === "create" ? "create entry" : "save changes"}</button>
    <button type="button" onclick={onCancel} disabled={saving}>cancel</button>
  </div>
</form>

<style>
  .entry-form { display: flex; flex-direction: column; gap: 0.6rem; max-width: 820px; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.82rem; color: var(--muted); }
  label.wide { width: 100%; }
  .hint { font-size: 0.72rem; opacity: 0.8; }
  input, textarea { font: inherit; color: var(--text); }
  textarea { resize: vertical; }
  .short { max-width: 10rem; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .check { flex-direction: row; align-items: center; gap: 0.4rem; padding-bottom: 0.4rem; }
  .structured { font-family: inherit; font-size: 0.82rem; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.25rem; }
  .mini { align-self: flex-start; font-size: 0.78rem; padding: 0.1rem 0.45rem; }
  .error { color: var(--danger); margin: 0; }
</style>
