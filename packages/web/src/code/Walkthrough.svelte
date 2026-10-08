<script lang="ts">
  import { tick } from "svelte";
  import { api } from "../api";
  import { gsap, reducedMotion } from "../motion/gsap";
  import { highlightLines, languageOf } from "../markdown/highlight";
  import { Button } from "../tui";
  import {
    fileQuery,
    isLit,
    numberedLines,
    type ShownStep,
    type WalkStep,
  } from "./walkthrough";

  let {
    title,
    steps,
    shown = undefined,
  }: {
    title: string;
    steps: WalkStep[];
    /** Absent until the server has checked every step's range. */
    shown?: ShownStep[];
  } = $props();

  interface LoadedLine {
    number: number;
    html: string;
  }
  type StepCode = LoadedLine[] | "loading" | { error: string };

  let at = $state(0);
  let code = $state<Record<number, StepCode>>({});
  /** Each loaded step's page on the repo's host; null when it has none. */
  let links = $state<Record<number, string | null>>({});
  let codeEl = $state<HTMLElement>();

  const step = $derived(steps[at]);
  const stepCode = $derived(code[at]);
  const where = $derived.by(() => {
    const read = shown?.[at];
    const range = `${step.path}:${step.start_line}-${step.end_line}`;
    if (!read) return range;
    return `${range} @ ${read.commit ? read.commit.slice(0, 7) : read.ref}`;
  });

  async function load(index: number) {
    const wanted = steps[index];
    code[index] = "loading";
    try {
      const file = await api.get<{ content: string; web_url: string | null }>(
        `/repos/${encodeURIComponent(wanted.repo)}/file?${fileQuery(wanted)}`,
      );
      links[index] = file.web_url;
      const lines = numberedLines(file.content);
      const markup = highlightLines(
        lines.map((l) => l.text).join("\n"),
        languageOf(wanted.path),
      );
      code[index] = lines.map((l, i) => ({
        number: l.number,
        html: markup[i],
      }));
    } catch (e) {
      code[index] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  $effect(() => {
    if (shown && code[at] === undefined) load(at);
  });

  $effect(() => {
    if (!Array.isArray(stepCode) || !codeEl || reducedMotion()) return;
    const rows = codeEl.querySelectorAll(".line");
    tick().then(() =>
      gsap.from(rows, {
        opacity: 0,
        x: 6,
        duration: 0.18,
        stagger: 0.012,
        ease: "power1.out",
        clearProps: "opacity,transform",
      }),
    );
  });

  function go(delta: number) {
    at = Math.min(Math.max(at + delta, 0), steps.length - 1);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    go(e.key === "ArrowRight" ? 1 : -1);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section
  class="walk"
  aria-label={`Code walkthrough: ${title}`}
  tabindex="0"
  onkeydown={onKeydown}
>
  <header class="head">
    <span class="title">{title}</span>
    <span class="repo">{step.repo}</span>
  </header>

  <div class="body">
    <ol class="rail">
      {#each steps as railStep, i (i)}
        <li>
          <button
            class="stop"
            class:active={i === at}
            aria-current={i === at ? "step" : undefined}
            onclick={() => (at = i)}
          >
            <span class="num">{i + 1}</span>
            <span class="name">{railStep.label}</span>
          </button>
        </li>
      {/each}
    </ol>

    <div class="pane">
      <div class="where">
        {#if links[at]}
          <a
            href={links[at]}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the whole file on the repo's host">{where}</a
          >
        {:else}
          {where}
        {/if}
      </div>
      <div class="code" bind:this={codeEl}>
        {#if Array.isArray(stepCode)}
          {#each stepCode as line (line.number)}
            <div class="line" class:lit={isLit(step, line.number)}>
              <span class="no">{line.number}</span>
              <!-- highlight() escapes the source; only its own spans are markup -->
              <code class="hljs">{@html line.html || " "}</code>
            </div>
          {/each}
        {:else if stepCode && stepCode !== "loading"}
          <div class="state err">{stepCode.error}</div>
        {:else}
          <div class="state">reading…</div>
        {/if}
      </div>
      <p class="note">{step.note}</p>
    </div>
  </div>

  <footer class="foot">
    <Button
      size="sm"
      square
      icon="back"
      title="Previous step (←)"
      aria-label="Previous step"
      disabled={at === 0}
      onclick={() => go(-1)}
    />
    <span class="count">{at + 1}/{steps.length}</span>
    <Button
      size="sm"
      square
      icon="next"
      title="Next step (→)"
      aria-label="Next step"
      disabled={at === steps.length - 1}
      onclick={() => go(1)}
    />
  </footer>
</section>

<style>
  .walk {
    width: 100%;
    margin: 0.35rem 0;
    background: var(--panel-solid);
    border: 3px double var(--muted);
    font-family: var(--font-mono);
    outline: none;
  }
  .walk:focus-visible {
    border-color: var(--accent);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 1ch;
    padding: 0.5rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .repo {
    font-size: 0.72rem;
    color: var(--muted);
  }

  .body {
    display: grid;
    grid-template-columns: minmax(9rem, 13rem) minmax(0, 1fr);
  }
  .rail {
    list-style: none;
    margin: 0;
    padding: 0.4rem 0;
    border-right: 1px solid var(--border);
  }
  .stop {
    display: flex;
    align-items: baseline;
    gap: 1ch;
    width: 100%;
    padding: 0.3rem 0.9rem;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 0;
    font: inherit;
    font-size: 0.78rem;
    color: var(--muted);
    text-align: left;
    cursor: pointer;
  }
  .stop:hover {
    color: var(--text);
  }
  .stop.active {
    color: var(--text);
    background: var(--accent-dim);
    border-left-color: var(--accent);
  }
  .num {
    flex: none;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane {
    min-width: 0;
  }
  .where {
    padding: 0.35rem 0.9rem;
    font-size: 0.72rem;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    overflow-wrap: anywhere;
  }
  .where a {
    color: inherit;
    text-decoration: underline dotted;
    text-underline-offset: 0.2em;
  }
  .where a:hover,
  .where a:focus-visible {
    color: var(--accent);
  }
  .code {
    max-height: min(65vh, 40rem);
    overflow: auto;
    padding: 0.4rem 0;
    font-size: 0.78rem;
    line-height: 1.5;
  }
  .line {
    display: flex;
    min-width: max-content;
    border-left: 2px solid transparent;
  }
  .line.lit {
    background: var(--accent-dim);
    border-left-color: var(--accent);
  }
  .no {
    flex: none;
    width: 5ch;
    padding-right: 1.5ch;
    text-align: right;
    color: var(--muted);
    user-select: none;
    font-variant-numeric: tabular-nums;
  }
  .line code {
    white-space: pre;
    background: transparent;
    padding: 0 0.9rem 0 0;
    font: inherit;
  }
  .state {
    padding: 0.6rem 0.9rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .state.err {
    color: var(--danger);
  }
  .note {
    margin: 0;
    padding: 0.55rem 0.9rem 0.65rem;
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1ch;
    padding: 0.35rem 0.9rem;
    border-top: 1px solid var(--border);
  }
  .count {
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 44rem) {
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      display: flex;
      overflow-x: auto;
      padding: 0;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
    .stop {
      border-left: none;
      border-bottom: 2px solid transparent;
    }
    .stop.active {
      border-bottom-color: var(--accent);
    }
  }
</style>
