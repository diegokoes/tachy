<script lang="ts" module>
  export type Found = { key: string; name: string };
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { gsap, reducedMotion } from "../motion/gsap";
  import { errText } from "../resource.svelte";
  import { GRID, shapes } from "../tui/icons";
  import { tip } from "../tui";

  let {
    source,
    label,
    takenTip,
    empty,
    hits,
    picked,
    registered,
    onfetch,
    onpick,
    below = false,
  }: {
    /** What is being asked, e.g. the connection or project. */
    source: string;
    /** The button's word, e.g. "fetch projects". */
    label: string;
    /** Said on a name that is already taken here. */
    takenTip: string;
    /** Said when the source answers with nothing. */
    empty: string;
    /** What it answered last time, if it has been asked. */
    hits: Found[] | undefined;
    /** The key the form holds now. */
    picked: string;
    registered: (key: string) => boolean;
    /** Asks the source and stores what it said; throws on failure. */
    onfetch: () => Promise<void>;
    onpick: (g: Found) => void;
    /** Swirl only under the tower, for a finder with no room above it. */
    below?: boolean;
  } = $props();

  /** Long enough for the broadcast to read as one, on a source that answers at once. */
  const HOLD = 1600;

  /** Past this many letters the flight is flown per tag, not per letter. */
  const MAX_LETTERS = 900;

  const TOWER = shapes("discover");
  /** The tower's lamp, which every wave swells out of. */
  const LAMP = { x: 12, y: 9 };

  let scanning = $state(false);
  let failure = $state<string | null>(null);

  let probe = $state<HTMLButtonElement>();
  let tower = $state<SVGSVGElement>();
  let signal = $state<SVGSVGElement>();
  let word = $state<HTMLElement>();
  let cloud = $state<HTMLElement>();

  const list = $derived(scanning ? [] : (hits ?? []));

  /** Once names have landed the tower stands alone; its label would only compete with them. */
  const landed = $derived(list.length > 0);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function run() {
    if (scanning || !source) return;
    failure = null;
    scanning = true;
    try {
      await Promise.all([onfetch(), wait(reducedMotion() ? 0 : HOLD)]);
      scanning = false;
      await tick();
      spread();
    } catch (e) {
      scanning = false;
      failure = errText(e);
    }
  }

  /* Picked out by shape rather than by position, because Lucide reorders an
     icon's nodes between releases: a wave is a stroke reaching above the lamp,
     and an inner one is the shorter of each pair. */
  const waves = () =>
    tower
      ? [...tower.querySelectorAll<SVGPathElement>("path")].filter(
          (p) => p.getBBox().y < LAMP.y,
        )
      : [];

  /** The tower calls: each wave swells out of the lamp, inner then outer, and
   *  the call it sends passes through the label. */
  function broadcast() {
    if (!probe || !tower || !signal || !word) return null;
    const all = waves();
    const inner = all.filter((p) => p.getBBox().height < 10);
    const outer = all.filter((p) => !inner.includes(p));
    const letters = [...word.querySelectorAll<HTMLElement>(".ch")];

    const box = probe.getBoundingClientRect();
    const mast = tower.getBoundingClientRect();
    const x0 = mast.left + mast.width / 2 - box.left;
    const x1 = word.getBoundingClientRect().right - box.left + 12;
    const travel = 0.7;
    const launch = 0.2;

    const swell = (targets: Element[], at: number) =>
      tl
        .fromTo(
          targets,
          { scale: 0.2, opacity: 0 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.35,
            ease: "power2.out",
          },
          at,
        )
        .to(
          targets,
          {
            scale: 1.2,
            opacity: 0,
            duration: 0.3,
            ease: "power1.in",
          },
          at + 0.45,
        );

    gsap.set(all, { svgOrigin: `${LAMP.x} ${LAMP.y}`, scale: 0.2, opacity: 0 });
    const tl = gsap.timeline({ repeat: -1 });
    swell(inner, 0);
    swell(outer, launch);
    tl.fromTo(
      signal,
      { x: x0, opacity: 0.9, scale: 0.5 },
      { x: x1, opacity: 0, scale: 1.5, duration: travel, ease: "none" },
      launch,
    );
    for (const ch of letters) {
      const r = ch.getBoundingClientRect();
      const at = (r.left + r.width / 2 - box.left - x0) / (x1 - x0);
      tl.to(
        ch,
        {
          "--lit": 1,
          y: "-0.2em",
          duration: 0.09,
          yoyo: true,
          repeat: 1,
          ease: "power2.out",
        },
        launch + Math.max(0, at) * travel,
      );
    }
    tl.to({}, { duration: 0.05 }, 1);
    return tl;
  }

  $effect(() => {
    if (!scanning || reducedMotion()) return;
    const tl = broadcast();
    return () => {
      tl?.kill();
      const letters = word ? [...word.querySelectorAll(".ch")] : [];
      gsap.set([...waves(), ...letters, signal].filter(Boolean), {
        clearProps: "all",
      });
    };
  });

  let flight: gsap.core.Timeline | null = null;

  /**
   * The names are already laid out where they belong; every letter starts
   * behind the tower, swirls out around it, then snaps into its slot. Only
   * transforms move, so the layout never shifts under the reader.
   */
  function spread() {
    flight?.kill();
    if (!cloud || !tower || reducedMotion()) return;
    const tags = [...cloud.querySelectorAll<HTMLElement>(".tag")];
    if (!tags.length) return;
    const letters = [...cloud.querySelectorAll<HTMLElement>(".tag .ch")];
    const movers = letters.length <= MAX_LETTERS ? letters : tags;
    const frames = [...cloud.querySelectorAll<HTMLElement>(".frame")];

    const mast = tower.getBoundingClientRect();
    const cx = mast.left + mast.width / 2;
    const cy = mast.top + mast.height / 2;
    const n = movers.length;
    const home = movers.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) };
    });
    const radius = Math.min(70, 6 * Math.sqrt(n));
    const swirl = (i: number) => {
      const r = 8 + radius * Math.sqrt(i / n);
      const y = r * Math.sin(i * 2.4);
      return { x: r * Math.cos(i * 2.4), y: below ? Math.abs(y) : y };
    };

    const tl = gsap.timeline({ onComplete: () => (flight = null) });
    if (movers === letters) tl.set(frames, { opacity: 0 }, 0);
    tl.fromTo(
      movers,
      {
        x: (i) => home[i].x,
        y: (i) => home[i].y,
        scale: 0.2,
        opacity: 0,
      },
      {
        x: (i) => home[i].x + swirl(i).x,
        y: (i) => home[i].y + swirl(i).y,
        scale: 0.6,
        opacity: 1,
        duration: 0.3,
        ease: "back.out(2)",
        stagger: { each: Math.min(0.004, 0.2 / n) },
      },
      0,
    ).to(
      movers,
      {
        x: 0,
        y: 0,
        scale: 1,
        duration: 0.45,
        ease: "power4.out",
        stagger: { each: Math.min(0.008, 0.3 / n) },
      },
      "-=0.15",
    );
    if (movers === letters)
      tl.fromTo(
        frames,
        { opacity: 0, scaleX: 0.7 },
        {
          opacity: 1,
          scaleX: 1,
          duration: 0.25,
          ease: "back.out(1.6)",
          stagger: { each: Math.min(0.01, 0.2 / frames.length) },
        },
        "-=0.2",
      );
    tl.set([...movers, ...frames], { clearProps: "all" });
    flight = tl;
  }

  onDestroy(() => flight?.kill());
</script>

<!-- A request fired at the source, not a field: the tower is the button, and
     what comes back lands under it. -->
<div class="finder">
  <button
    bind:this={probe}
    class="probe"
    class:scanning
    type="button"
    disabled={!source}
    aria-label="{label} from {source}"
    aria-busy={scanning}
    use:tip={landed ? `${label} again` : undefined}
    onclick={run}
  >
    <svg
      bind:this={tower}
      class="tower"
      viewBox="0 0 {GRID} {GRID}"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {#each TOWER as [tag, attrs], i (i)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    <span class="word" class:gone={landed} bind:this={word} aria-hidden="true"
      >{#each [...label] as ch, i (i)}<span class="ch">{ch}</span>{/each}</span
    >
    <svg
      bind:this={signal}
      class="signal"
      viewBox="0 0 12 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"><path d="M2 2a14 14 0 0 1 0 20" /></svg
    >
  </button>

  {#if failure}
    <p class="quiet danger">{failure}</p>
  {/if}

  <div class="cloud" bind:this={cloud}>
    {#each list as g (g.key)}
      {@const taken = registered(g.key)}
      <button
        type="button"
        class="tag"
        class:on={picked === g.key}
        disabled={taken}
        aria-pressed={picked === g.key}
        use:tip={taken
          ? `${g.key} · ${takenTip}`
          : g.name === g.key
            ? undefined
            : g.key}
        onclick={() => onpick(g)}
      >
        <span class="frame" aria-hidden="true"></span>
        <span class="name"
          >{#each [...g.name] as ch, i (i)}<span class="ch">{ch}</span
            >{/each}</span
        >
      </button>
    {/each}
    {#if hits && !scanning && !list.length && !failure}
      <p class="quiet">{empty}</p>
    {/if}
  </div>
</div>

<style>
  .finder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-3);
    /* Room above the tower for the swirl, which reaches about 80px out from
       the lamp, so the letters never cross the fields over it. */
    margin-top: var(--finder-air, 3.5rem);
    min-height: 16rem;
  }

  /* Only the tower is in flow, so it is what gets centred; the label hangs
     off its right side and still belongs to the button. */
  .probe {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: var(--pad-2);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--muted);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-md);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .probe:hover:not(:disabled),
  .probe:focus-visible,
  .probe.scanning {
    color: var(--text);
  }
  .probe:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .probe.scanning {
    cursor: progress;
  }

  .tower {
    position: relative;
    z-index: 1;
    width: 2.8em;
    height: 2.8em;
    flex: none;
    color: var(--accent);
  }
  .word {
    position: absolute;
    left: calc(100% + var(--pad-1));
    top: 50%;
    transform: translateY(-50%);
    white-space: pre;
    transition:
      opacity 0.2s ease,
      visibility 0.2s;
  }
  .word.gone {
    opacity: 0;
    visibility: hidden;
  }

  /* Tinted by --lit, which the broadcast raises as a call passes a letter. */
  .ch {
    display: inline-block;
    --lit: 0;
    color: color-mix(
      in srgb,
      var(--accent) calc(var(--lit) * 100%),
      currentColor
    );
  }

  .signal {
    position: absolute;
    left: 0;
    top: 50%;
    width: 1em;
    height: 2em;
    margin-top: -1em;
    color: var(--accent);
    opacity: 0;
    pointer-events: none;
  }

  .cloud {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-content: flex-start;
    gap: var(--pad-2);
    width: 100%;
  }

  .tag {
    position: relative;
    padding: var(--pad-1) var(--pad-3);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    line-height: 1.5;
    white-space: pre;
    cursor: pointer;
  }
  .frame {
    position: absolute;
    inset: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-chip);
    background: var(--accent-dim);
    transition: border-color 0.15s ease;
  }
  .name {
    position: relative;
  }
  .tag:hover:not(:disabled) .frame,
  .tag:focus-visible .frame {
    border-color: var(--accent);
  }
  .tag.on {
    color: var(--accent);
  }
  .tag.on .frame {
    border-color: var(--accent);
  }
  .tag:disabled {
    color: var(--muted);
    cursor: default;
  }
  .tag:disabled .frame {
    background: none;
    border-color: var(--border);
  }

  .quiet {
    margin: 0;
    text-align: center;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .quiet.danger {
    color: var(--danger);
  }
</style>
