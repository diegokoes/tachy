<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { gsap, reducedMotion } from "../gsap";
  import Icon from "../tui/Icon.svelte";

  let { structured }: { structured: Record<string, unknown> } = $props();

  let showRaw = $state(false);
  let jsonBody = $state<HTMLElement>();
  let jsonView = $state<HTMLElement>();
  let jsonAnimation: gsap.core.Tween | undefined;

  const KNOWN = [
    "environment", "key_signals", "investigation_steps", "conversation_summary",
    "technical_analysis", "constraints_and_rules", "related_configuration", "related_links",
  ];

  const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const asList = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.map((x) => String(x)) : null;
  const asText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const environment = $derived(asRecord(structured.environment));
  const keySignals = $derived(asRecord(structured.key_signals));
  const steps = $derived(asList(structured.investigation_steps));
  const summary = $derived(asText(structured.conversation_summary));
  const analysis = $derived(asRecord(structured.technical_analysis));
  const rules = $derived(asList(structured.constraints_and_rules));
  const config = $derived(asList(structured.related_configuration));
  const links = $derived(asList(structured.related_links));
  const extras = $derived(
    Object.fromEntries(Object.entries(structured).filter(([k]) => !KNOWN.includes(k))),
  );

  const labelize = (k: string) => k.replaceAll("_", " ");
  const jsonText = $derived(JSON.stringify(structured, null, 2));
  const escapeHtml = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const highlightedJson = $derived(
    jsonText.replace(
      /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|-?\b\d+(?:\.\d+)?\b/g,
      (match, key, string, boolean, nil) => {
        const kind = key
          ? "json-key"
          : string
            ? "json-string"
            : boolean
              ? "json-boolean"
              : nil
                ? "json-null"
                : "json-number";
        return `<span class="${kind}">${escapeHtml(match)}</span>`;
      },
    ),
  );

  $effect(() => {
    if (!showRaw || !jsonBody) return;
    jsonAnimation?.kill();
    const tokens = jsonBody.querySelectorAll<HTMLElement>("span");
    if (reducedMotion()) {
      gsap.set(tokens, { clearProps: "opacity,scale,x,y,rotation" });
      return;
    }
    jsonAnimation = gsap.from(tokens, {
      x: () => Math.cos(Math.random() * Math.PI * 2) * 22,
      y: () => Math.sin(Math.random() * Math.PI * 2) * 22,
      rotation: () => gsap.utils.random(-16, 16),
      scale: 0.94,
      opacity: 0,
      stagger: 0.012,
      duration: 0.42,
      ease: "power2.out",
    });
  });

  onDestroy(() => jsonAnimation?.kill());

  async function toggleRaw() {
    showRaw = !showRaw;
    if (!showRaw) return;
    await tick();
    if (!jsonView) return;
    const container = jsonView.closest("main") as HTMLElement | null;
    if (!container) return;
    const target =
      container.scrollTop +
      jsonView.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      24;
    gsap.to(container, {
      scrollTop: target,
      duration: 0.82,
      ease: "power3.inOut",
      overwrite: "auto",
    });
  }
</script>

<div class="structured">
  {#if environment && Object.keys(environment).length}
    <div class="block">
      <h4>Environment</h4>
      <dl>
        {#each Object.entries(environment) as [k, v]}
          <dt>{labelize(k)}</dt><dd>{String(v)}</dd>
        {/each}
      </dl>
    </div>
  {/if}

  {#if keySignals && Object.keys(keySignals).length}
    <div class="block">
      <h4>Key signals</h4>
      <dl>
        {#each Object.entries(keySignals) as [k, v]}
          <dt>{labelize(k)}</dt><dd>{String(v)}</dd>
        {/each}
      </dl>
    </div>
  {/if}

  {#if analysis && Object.keys(analysis).length}
    <div class="block">
      <h4>Technical analysis</h4>
      <dl>
        {#each Object.entries(analysis) as [k, v]}
          <dt>{labelize(k)}</dt><dd>{String(v)}</dd>
        {/each}
      </dl>
    </div>
  {/if}

  {#if steps?.length}
    <div class="block">
      <h4>Investigation steps</h4>
      <ol>{#each steps as s}<li>{s}</li>{/each}</ol>
    </div>
  {/if}

  {#if summary}
    <div class="block">
      <h4>Conversation summary</h4>
      <p>{summary}</p>
    </div>
  {/if}

  {#if rules?.length}
    <div class="block">
      <h4>Constraints &amp; rules</h4>
      <ul>{#each rules as r}<li>{r}</li>{/each}</ul>
    </div>
  {/if}

  {#if config?.length}
    <div class="block">
      <h4>Related configuration</h4>
      <ul>{#each config as f}<li><code>{f}</code></li>{/each}</ul>
    </div>
  {/if}

  {#if links?.length}
    <div class="block">
      <h4>Related links</h4>
      <ul>
        {#each links as l}
          <li>
            {#if /^https?:\/\//.test(l)}
              <a href={l} target="_blank" rel="noopener noreferrer">{l}</a>
            {:else}
              {l}
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if Object.keys(extras).length && !showRaw}
    <div class="block">
      <h4>Other</h4>
      <pre>{JSON.stringify(extras, null, 2)}</pre>
    </div>
  {/if}

  <button
    class="json-toggle"
    aria-label={showRaw ? "Show rendered knowledge entry" : "Show raw JSON"}
    title={showRaw ? "Show rendered view" : "Show raw JSON"}
    onclick={() => void toggleRaw()}
  >
    <Icon name="json" size="1.8rem" />
  </button>
  {#if showRaw}
    <pre class="json-view" bind:this={jsonView}><code bind:this={jsonBody}>{@html highlightedJson}</code></pre>
  {/if}
</div>

<style>
  .structured { display: flex; flex-direction: column; gap: var(--pad-4); }
  /* No box per key — these already sit inside a bordered section, and eight
     nested cards read as clutter. A left rule marks the block instead. */
  .block { border-left: 1px solid var(--border); padding-left: var(--pad-3); }
  h4 { margin: 0 0 var(--pad-2); font-size: var(--fs-xs); color: var(--muted); text-transform: uppercase; letter-spacing: var(--label-spacing); }
  dl { display: grid; grid-template-columns: minmax(7rem, max-content) 1fr; gap: var(--pad-1) var(--pad-3); margin: 0; }
  dt { color: var(--muted); font-size: var(--fs-xs); }
  dd { margin: 0; white-space: pre-wrap; line-height: 1.6; font-size: var(--fs-sm); }
  ol, ul { margin: 0; padding-left: 1.25rem; }
  li { line-height: 1.6; font-size: var(--fs-sm); }
  p { margin: 0; white-space: pre-wrap; line-height: 1.6; font-size: var(--fs-sm); }
  /* Scoped to the blocks: the raw JSON body is a <code> too, and an accent
     tint behind a syntax-highlighted dump only muddies it. */
  .block code { background: var(--accent-dim); padding: 0 var(--pad-1); border-radius: var(--radius); font-size: var(--fs-xs); }
  a { color: var(--accent); word-break: break-all; }
  pre { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--pad-3); overflow: auto; font-size: var(--fs-xs); margin: 0; }
  .json-toggle { align-self: center; display: grid; place-items: center; color: var(--text); background: transparent; border: 0; padding: var(--pad-1); cursor: pointer; }
  .json-toggle:hover { color: var(--accent); }
  .json-view { color: #e2e2e2; background: #000; overflow: visible; white-space: pre-wrap; }
  :global(:root[data-theme="light"]) .json-view { color: #000; background: #fff; }
  :global(.json-key) { color: #9c36b5; }
  :global(.json-string) { color: #2b8a3e; }
  :global(.json-number) { color: #d9480f; }
  :global(.json-boolean), :global(.json-null) { color: #1971c2; }
  :global(:root[data-theme="dark"] .json-key) { color: #e599f7; }
  :global(:root[data-theme="dark"] .json-string) { color: #8ce99a; }
  :global(:root[data-theme="dark"] .json-number) { color: #ffa94d; }
  :global(:root[data-theme="dark"] .json-boolean),
  :global(:root[data-theme="dark"] .json-null) { color: #74c0fc; }
</style>
