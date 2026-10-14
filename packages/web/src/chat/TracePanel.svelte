<script lang="ts">
  import { Icon } from "../tui";
  import {
    modelMismatch,
    ranOn,
    redactedCount,
    resultText,
    type TurnTrace,
  } from "./trace";

  let { trace }: { trace: TurnTrace } = $props();

  const mismatch = $derived(modelMismatch(trace));
  const calls = $derived(
    trace.calls.map((call) => {
      const text = resultText(call.result);
      return { ...call, text, redacted: redactedCount(text) };
    }),
  );

  const list = (names: string[] | undefined) =>
    names?.length ? names.join(", ") : "none";

  const facts = $derived<[string, string][]>([
    ["model asked", trace.sent.model ?? "settings default"],
    ["effort asked", trace.sent.effort ?? "settings default"],
    ["model started", trace.session?.model ?? "not reported"],
    ["model answered", list(trace.answeredBy)],
    ["credential", trace.session?.credentialSource ?? "not reported"],
    [
      "mcp servers",
      list(trace.session?.mcpServers.map((s) => `${s.name} (${s.status})`)),
    ],
    ["skills", list(trace.session?.skills)],
    ["plugins", list(trace.session?.plugins)],
    ["auto-approved", list(trace.sent.autoApprove)],
    [
      "redaction",
      trace.sent.redactionForced ? "forced on everywhere" : "per connection",
    ],
  ]);
</script>

<div class="trace">
  <details>
    <summary>
      <Icon name="bug" size="1em" weight={7} />
      <span>sent</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class:bad={mismatch}>{ranOn(trace)}</span>
      {#if trace.sent.effort}
        <span class="sep" aria-hidden="true">·</span>
        <span>{trace.sent.effort}</span>
      {/if}
      {#if trace.sent.resumed}
        <span class="sep" aria-hidden="true">·</span>
        <span>resumed</span>
      {/if}
      <span class="sep" aria-hidden="true">·</span>
      <span>{trace.sent.prompt.length} chars</span>
    </summary>
    {#if mismatch}<p class="bad">{mismatch}</p>{/if}
    <dl>
      {#each facts as [name, value] (name)}
        <dt>{name}</dt>
        <dd>{value}</dd>
      {/each}
    </dl>
    <details>
      <summary>prompt</summary>
      <pre>{trace.sent.prompt}</pre>
    </details>
    <details>
      <summary>system prompt · {trace.sent.systemPrompt.length} chars</summary>
      <pre>{trace.sent.systemPrompt}</pre>
    </details>
    <details>
      <summary>tools · {trace.session?.tools.length ?? 0}</summary>
      <pre>{list(trace.session?.tools)}</pre>
    </details>
  </details>
  {#each calls as call, n (n)}
    <details>
      <summary>
        <Icon name="tool" size="1em" weight={7} />
        <span>{call.tool}</span>
        {#if call.result === undefined}
          <span class="sep" aria-hidden="true">·</span>
          <span>no result yet</span>
        {:else}
          <span class="sep" aria-hidden="true">·</span>
          <span>{call.text.length} chars</span>
          <span class="sep" aria-hidden="true">·</span>
          <span>{call.redacted} redacted</span>
        {/if}
      </summary>
      {#if call.input !== undefined}
        <p>input</p>
        <pre>{JSON.stringify(call.input, null, 2)}</pre>
      {/if}
      {#if call.result !== undefined}
        <p>result</p>
        <pre>{call.text}</pre>
      {/if}
    </details>
  {/each}
</div>

<style>
  .trace {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    padding-left: 1ch;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0 0.5ch;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover,
  details[open] > summary {
    color: var(--text);
  }
  details details {
    margin: var(--pad-1) 0 0 2ch;
  }
  .sep {
    opacity: 0.55;
    user-select: none;
  }
  .bad {
    color: var(--danger);
  }
  p {
    margin: var(--pad-1) 0 0 2ch;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0 2ch;
    margin: var(--pad-1) 0 0 2ch;
  }
  dd {
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  pre {
    margin: var(--pad-1) 0 0 2ch;
    padding: var(--pad-2);
    max-height: 24em;
    overflow: auto;
    border-left: 2px solid var(--line, currentColor);
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
</style>
