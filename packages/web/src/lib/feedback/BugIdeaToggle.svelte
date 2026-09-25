<script lang="ts">
  import { Icon } from "../tui";
  import { gsap, SplitText, reducedMotion } from "../gsap";
  import { ripple } from "../motion";
  import type { ReportType } from "@tachy/contract";

  let {
    value = $bindable(null),
    onpick,
  }: {
    value?: ReportType | null;
    onpick?: (v: ReportType) => void;
  } = $props();

  let trackEl = $state<HTMLElement>();
  let knobEl = $state<HTMLElement>();
  let bugIcon = $state<SVGSVGElement>();
  let ideaIcon = $state<SVGSVGElement>();
  let dotEl = $state<HTMLElement>();
  let bugLabel = $state<HTMLElement>();
  let ideaLabel = $state<HTMLElement>();

  let ready = false;

  function pick(v: ReportType) {
    if (value === v) return;
    value = v;
    onpick?.(v);
  }

  // The knob keeps the same inset from the ends as it does from the top and
  // bottom, so it sits in the track the same way at rest and at either side.
  function knobX(v: ReportType | null): number {
    const track = trackEl!.getBoundingClientRect();
    const knob = knobEl!.getBoundingClientRect();
    const border = trackEl!.clientLeft;
    const inner = { w: track.width - 2 * border, h: track.height - 2 * border };
    const inset = (inner.h - knob.height) / 2;
    if (v === "bug") return inset;
    if (v === "feature") return inner.w - knob.width - inset;
    return (inner.w - knob.width) / 2;
  }

  let bugChars: Element[] = [];
  let ideaChars: Element[] = [];

  $effect(() => {
    if (!bugLabel || !ideaLabel) return;
    const splits = [
      new SplitText(bugLabel, { type: "chars" }),
      new SplitText(ideaLabel, { type: "chars" }),
    ];
    [bugChars, ideaChars] = splits.map((s) => s.chars);
    return () => splits.forEach((s) => s.revert());
  });

  const KNOB_SECONDS = 0.5;
  // back.out(1.6) first reaches its end value at ~38% of the tween; that is the
  // moment the knob meets the side, before the overshoot settles.
  const KNOB_ARRIVES = KNOB_SECONDS * 0.38;

  // Position the knob, crossfade the face, and ripple the chosen label — all
  // driven off `value`, so a keyboard pick animates the same as a click.
  $effect(() => {
    const v = value;
    if (!trackEl || !knobEl) return;
    const animate = ready && !reducedMotion();
    const dur = animate ? KNOB_SECONDS : 0;
    gsap.to(knobEl, { x: knobX(v), duration: dur, ease: "back.out(1.6)" });

    const faces: [SVGSVGElement | HTMLElement | undefined, boolean][] = [
      [dotEl, v === null],
      [bugIcon, v === "bug"],
      [ideaIcon, v === "feature"],
    ];
    for (const [el, on] of faces)
      if (el)
        gsap.to(el, {
          autoAlpha: on ? 1 : 0,
          scale: on ? 1 : 0.4,
          rotate: on ? 0 : -40,
          duration: dur,
          ease: "back.out(2)",
        });

    // The wave starts at the letter nearest the track, where the knob lands.
    if (ready && v === "bug")
      ripple(bugChars, { from: "end", delay: KNOB_ARRIVES });
    if (ready && v === "feature")
      ripple(ideaChars, { from: "start", delay: KNOB_ARRIVES });
    ready = true;
  });
</script>

<div class="toggle" data-value={value ?? "none"}>
  <span class="side bug" bind:this={bugLabel}>BUG</span>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="track"
    bind:this={trackEl}
    role="radiogroup"
    aria-label="report type"
  >
    <button
      type="button"
      class="zone left"
      role="radio"
      aria-checked={value === "bug"}
      aria-label="report a bug"
      onclick={() => pick("bug")}
    ></button>
    <button
      type="button"
      class="zone right"
      role="radio"
      aria-checked={value === "feature"}
      aria-label="request a feature"
      onclick={() => pick("feature")}
    ></button>

    <div class="knob" bind:this={knobEl} aria-hidden="true">
      <span class="face dot" bind:this={dotEl}></span>
      <Icon name="bug" bind:el={bugIcon} size="1.3em" weight={7} />
      <Icon name="lightbulb" bind:el={ideaIcon} size="1.3em" weight={7} />
    </div>
  </div>

  <span class="side idea" bind:this={ideaLabel}>IDEA</span>
</div>

<style>
  /* Idea blue lives here so both the track and the label wave read from one
     token; bug reuses the app's danger red. */
  .toggle {
    --report-idea: #38bdf8;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-4);
    user-select: none;
  }

  .side {
    font-size: var(--fs-lg);
    letter-spacing: var(--label-spacing);
    font-weight: 600;
    color: var(--muted);
    transition: color 0.3s ease 0.15s;
  }
  .toggle[data-value="bug"] .side.bug {
    color: var(--danger);
  }
  .toggle[data-value="feature"] .side.idea {
    color: var(--report-idea);
  }

  .track {
    position: relative;
    width: 7.5rem;
    height: 3.2rem;
    border-radius: 3.2rem;
    background: var(--surface-2, rgba(255, 255, 255, 0.08));
    border: var(--panel-line);
    transition: background 0.4s ease, border-color 0.4s ease;
  }
  .toggle[data-value="bug"] .track {
    background: color-mix(in srgb, var(--danger) 28%, transparent);
    border-color: var(--danger);
  }
  .toggle[data-value="feature"] .track {
    background: color-mix(in srgb, var(--report-idea) 28%, transparent);
    border-color: var(--report-idea);
  }

  /* Two halves you press to choose a side; the knob rides above them. */
  .zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .zone.left {
    left: 0;
  }
  .zone.right {
    right: 0;
  }
  .zone:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
    border-radius: 3.2rem;
  }

  /* Auto block margins centre it between the track's top and bottom; the 3px
     inset matches what knobX leaves at either end. */
  .knob {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    margin: auto 0;
    width: calc(3.2rem - 2 * var(--panel-line-w) - 6px);
    height: calc(3.2rem - 2 * var(--panel-line-w) - 6px);
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #fff, #d7d7d7);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .toggle[data-value="bug"] .knob {
    color: var(--danger);
  }
  .toggle[data-value="feature"] .knob {
    color: var(--report-idea);
  }
  .toggle[data-value="none"] .knob {
    color: #9b9b9b;
  }

  /* All three faces share the one cell; the effect fades the inactive ones out. */
  .knob :global(svg),
  .face {
    grid-area: 1 / 1;
  }
  .face.dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: currentColor;
  }
</style>
