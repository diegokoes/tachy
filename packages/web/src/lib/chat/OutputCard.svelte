<script lang="ts" module>
  export interface OutputFile {
    id: string;
    filename: string;
    mime: string;
    byte_size: number;
    rows?: number;
    columns?: number;
    url: string;
    expires_at?: string;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { reducedMotion } from "../gsap";

  let { file = undefined }: { file?: OutputFile } = $props();

  const W = 22;
  const FILL = "▒▓█";

  let tick = $state(0);
  let reduced = $state(typeof window !== "undefined" && reducedMotion());

  const done = $derived(!!file);

  const band = $derived.by(() => {
    const head = tick % (W + 6);
    let s = "";
    for (let i = 0; i < W; i++) {
      const d = head - i;
      s += d < 0 || d > 5 ? " " : FILL[Math.min(2, Math.floor(d / 2))];
    }
    return s;
  });

  const ext = $derived(
    (file?.filename.split(".").pop() ?? "file").toUpperCase(),
  );

  const size = $derived.by(() => {
    const n = file?.byte_size ?? 0;
    if (n < 1024) return `${n} b`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} kb`;
    return `${(n / (1024 * 1024)).toFixed(1)} mb`;
  });

  const shape = $derived(
    file?.rows != null && file?.columns != null
      ? `${file.rows.toLocaleString()} × ${file.columns}`
      : undefined,
  );

  onMount(() => {
    if (reduced) return;
    const iv = setInterval(() => {
      if (!done) tick++;
    }, 70);
    return () => clearInterval(iv);
  });
</script>

<div class="oc" role="status">
  <span class="corner tl" aria-hidden="true">╔</span>
  <span class="corner tr" aria-hidden="true">╗</span>
  <span class="corner bl" aria-hidden="true">╚</span>
  <span class="corner br" aria-hidden="true">╝</span>

  <div class="head">┤ {done ? "file ready" : "building file"} ├</div>

  {#if !done}
    {#if reduced}
      <div class="label">generating…</div>
    {:else}
      <pre class="band" aria-hidden="true">[{band}]</pre>
      <div class="label">writing rows…</div>
    {/if}
  {:else if file}
    <div class="body">
      <span class="ext" aria-hidden="true">{ext}</span>
      <span class="detail">
        <span class="name" title={file.filename}>{file.filename}</span>
        <span class="facts">
          {size}{#if shape} · {shape} cells{/if}
        </span>
      </span>
      <a class="get" href={file.url} download={file.filename}>download</a>
    </div>
  {/if}
</div>

<style>
  .oc {
    position: relative;
    align-self: flex-start;
    width: min(34rem, 100%);
    margin: 0.35rem 0;
    padding: 0.75rem 1.15rem 0.85rem;
    background: var(--panel-solid);
    border: 3px double var(--muted);
    font-family: ui-monospace, "Cascadia Mono", monospace;
    background-image: repeating-linear-gradient(
      var(--bg) 0 1px,
      transparent 1px 3px
    );
    background-blend-mode: soft-light;
  }
  .corner {
    position: absolute;
    line-height: 1;
    font-size: 1.1rem;
    color: var(--muted);
    background: var(--panel-solid);
    padding: 0 1px;
    user-select: none;
  }
  .tl { top: -0.6rem; left: -0.35rem; }
  .tr { top: -0.6rem; right: -0.35rem; }
  .bl { bottom: -0.6rem; left: -0.35rem; }
  .br { bottom: -0.6rem; right: -0.35rem; }

  .head {
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    color: var(--accent);
    text-transform: uppercase;
  }
  .band {
    margin: 0.5rem 0 0.25rem;
    font-size: 0.9rem;
    letter-spacing: 0.06em;
    color: var(--accent);
    user-select: none;
    white-space: pre;
  }
  .label {
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  .body {
    margin-top: 0.55rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }
  .ext {
    flex: none;
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
    min-width: 0;
  }
  .name {
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .facts {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .get {
    flex: none;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.75rem;
    text-decoration: none;
  }
  .get:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
