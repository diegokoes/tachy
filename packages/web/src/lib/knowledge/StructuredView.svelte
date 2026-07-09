<script lang="ts">
  
  
  
  let { structured }: { structured: Record<string, unknown> } = $props();

  let showRaw = $state(false);

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

  <button class="mini raw-toggle" onclick={() => (showRaw = !showRaw)}>
    {showRaw ? "[rendered]" : "[raw]"}
  </button>
  {#if showRaw}
    <pre>{JSON.stringify(structured, null, 2)}</pre>
  {/if}
</div>

<style>
  .structured { display: flex; flex-direction: column; gap: 0.6rem; }
  .block { border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; background: var(--panel); }
  h4 { margin: 0 0 0.35rem; font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  dl { display: grid; grid-template-columns: minmax(7rem, max-content) 1fr; gap: 0.15rem 0.75rem; margin: 0; }
  dt { color: var(--muted); font-size: 0.82rem; }
  dd { margin: 0; white-space: pre-wrap; line-height: 1.45; font-size: 0.88rem; }
  ol, ul { margin: 0; padding-left: 1.25rem; }
  li { line-height: 1.5; font-size: 0.88rem; }
  p { margin: 0; white-space: pre-wrap; line-height: 1.5; font-size: 0.88rem; }
  code { background: var(--accent-dim); padding: 0 0.3rem; border-radius: 3px; font-size: 0.82rem; }
  a { color: var(--accent); word-break: break-all; }
  pre { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem; overflow: auto; font-size: 0.8rem; margin: 0; }
  .raw-toggle { align-self: flex-start; font-size: 0.75rem; padding: 0.1rem 0.4rem; }
</style>
