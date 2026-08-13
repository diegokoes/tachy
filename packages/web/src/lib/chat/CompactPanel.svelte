<script lang="ts">
  import { onMount } from "svelte";
  import { gsap, reducedMotion } from "../gsap";

  export interface CompactStats {
    source_messages: number;
    turns: number;
    raw_chars: number;
    compact_chars: number;
    dropped: {
      automated: number;
      auto_reply: number;
      exact_duplicate_blocks: number;
      near_duplicate_blocks: number;
      boilerplate_lines: number;
      prior_transcript: number;
    };
    recovered_earlier: number;
  }

  let {
    title = "",
    stats = undefined,
  }: { title?: string; stats?: CompactStats } = $props();

  const W = 22;
  const DENSE = "█▓▒░";

  let tick = $state(0);
  // resolved at init, not in onMount: the counter effect runs before mount
  let reduced = $state(typeof window !== "undefined" && reducedMotion());
  let root = $state<HTMLElement>();

  const done = $derived(!!stats);

  /**
   * Squeeze: a full-width band of dense glyphs collapses toward the centre,
   * leaving the compacted remainder behind.
   */
  const band = $derived.by(() => {
    const phase = (tick % 44) / 44;
    const kept = Math.max(3, Math.round(W * (1 - phase * 0.72)));
    const pad = Math.floor((W - kept) / 2);
    let s = "";
    for (let i = 0; i < W; i++) {
      if (i < pad || i >= pad + kept) {
        s += " ";
        continue;
      }
      const d = (i + tick) % DENSE.length;
      s += DENSE[phase > 0.62 ? Math.min(d, 1) : d];
    }
    return s;
  });

  const saved = $derived(
    stats && stats.raw_chars
      ? Math.max(
          0,
          Math.round(
            (100 * (stats.raw_chars - stats.compact_chars)) / stats.raw_chars,
          ),
        )
      : 0,
  );

  const kb = (n: number) => Math.round(n / 1024);

  interface Metric {
    key: string;
    label: string;
    value: number;
    suffix?: string;
  }

  const metrics = $derived.by<Metric[]>(() => {
    if (!stats) return [];
    const d = stats.dropped;
    const all: Metric[] = [
      { key: "msgs", label: "messages", value: stats.source_messages },
      { key: "pct", label: "less to read", value: saved, suffix: "%" },
      {
        key: "kept",
        label: `to read, was ${kb(stats.raw_chars)}kb`,
        value: kb(stats.compact_chars),
        suffix: "kb",
      },
      {
        key: "dup",
        label: "repeated quotes cut",
        value: d.exact_duplicate_blocks + d.near_duplicate_blocks,
      },
      {
        key: "boiler",
        label: "signature/footer lines cut",
        value: d.boilerplate_lines,
      },
      {
        key: "auto",
        label: "automated mails cut",
        value: d.automated + d.auto_reply,
      },
      {
        key: "found",
        label: "older mails recovered",
        value: stats.recovered_earlier,
      },
    ];
    // a row reading "0" teaches nothing; the first three always show
    return all.filter((m, i) => i < 3 || m.value > 0);
  });

  /**
   * One shared slot, wide enough for the largest final value, so counters keep
   * their labels aligned and nothing reflows as digits appear.
   */
  const slot = $derived(
    metrics.reduce(
      (w, m) =>
        Math.max(w, m.value.toLocaleString().length + (m.suffix?.length ?? 0)),
      1,
    ),
  );

  let animated = false;
  $effect(() => {
    if (!done || animated || !root) return;
    animated = true;
    const nodes = root.querySelectorAll<HTMLElement>("[data-val]");
    if (reduced) {
      for (const el of nodes) el.textContent = el.dataset.final ?? "";
      return;
    }
    nodes.forEach((el, i) => {
      const target = Number(el.dataset.val ?? 0);
      const suffix = el.dataset.suffix ?? "";
      const obj = { val: 0 };
      gsap.to(obj, {
        val: target,
        duration: 2.6,
        delay: i * 0.08,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = Math.round(obj.val).toLocaleString() + suffix;
        },
      });
    });
  });

  onMount(() => {
    if (reduced) return;
    const iv = setInterval(() => {
      if (!done) tick++;
    }, 70);
    return () => clearInterval(iv);
  });
</script>

<div class="cp" bind:this={root} role="status">
  <span class="corner tl" aria-hidden="true">╔</span>
  <span class="corner tr" aria-hidden="true">╗</span>
  <span class="corner bl" aria-hidden="true">╚</span>
  <span class="corner br" aria-hidden="true">╝</span>

  <div class="head">┤ {done ? "compacted" : "compacting"} ├</div>
  {#if title}<div class="subject">{title}</div>{/if}

  {#if !done}
    {#if reduced}
      <div class="label">compressing…</div>
    {:else}
      <pre class="band" aria-hidden="true">[{band}]</pre>
      <div class="label">stripping quotes, footers &amp; repeats…</div>
    {/if}
  {:else}
    <div class="grid">
      {#each metrics as m (m.key)}
        <div class="metric">
          <span
            class="val"
            style="min-width:{slot}ch"
            data-val={m.value}
            data-suffix={m.suffix ?? ""}
            data-final={m.value.toLocaleString() + (m.suffix ?? "")}
            >{reduced ? m.value.toLocaleString() + (m.suffix ?? "") : "0"}</span
          >
          <span class="lbl">{m.label}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cp {
    position: relative;
    align-self: flex-start;
    width: min(34rem, 100%);
    margin: 0.35rem 0;
    padding: 0.75rem 1.15rem 0.85rem;
    background: var(--panel-solid);
    /* double rule + seated corners = the text-mode box the modals use */
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
  .subject {
    margin-top: 0.15rem;
    font-size: 0.74rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .grid {
    margin-top: 0.55rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.35rem 1.2rem;
  }
  .metric {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    min-width: 0;
  }
  .val {
    /* tabular figures + a reserved slot keep the grid still while counting */
    font-variant-numeric: tabular-nums;
    font-size: 0.95rem;
    color: var(--accent);
    text-align: right;
    flex: none;
  }
  .lbl {
    font-size: 0.7rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
