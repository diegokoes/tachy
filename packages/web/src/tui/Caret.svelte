<script module lang="ts">
  export type CaretSide = "mid" | "lead" | "tail" | "bare";

  /**
   * Which side of the point a caret stands on. Between two letters it is
   * centred; with a letter on one side only it steps into the free side, and
   * with none it stands with its left edge on the point, where the next
   * letter will start.
   */
  export function caretSide(text: string, pos: number): CaretSide {
    const before = /\S/.test(text.charAt(pos - 1));
    const after = /\S/.test(text.charAt(pos));
    if (before === after) return before ? "mid" : "bare";
    return before ? "tail" : "lead";
  }
</script>

<script lang="ts">
  import { gsap, reducedMotion } from "../motion/gsap";
  import { iconPath, shapes, type IconName } from "./icons";

  const CARET = { x: 2, y: 2, w: 4, h: 20, width: 0.23, stroke: 2.9 };
  const MARK = { x: 0, y: 0, w: 24, h: 24, width: 1.15, stroke: 1.7 };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  let {
    beat,
    side = "mid",
    icon,
    idle = false,
  }: {
    /**
     * Anything that changes on activity. The flash starts over when it does,
     * so the caret stays lit while someone is typing.
     */
    beat?: unknown;
    /** Where it stands against the letters around it; see `caretSide`. */
    side?: CaretSide;
    /**
     * A mark the caret rests as while `idle`, and morphs into when it is not:
     * the field's own picture, standing where the first letter will start.
     */
    icon?: IconName;
    idle?: boolean;
  } = $props();

  let svg: SVGSVGElement | undefined = $state();
  let shape: SVGPathElement | undefined = $state();
  const prog = { t: 0 };

  function apply() {
    if (!svg) return;
    const t = prog.t;
    const x = lerp(CARET.x, MARK.x, t);
    const y = lerp(CARET.y, MARK.y, t);
    const w = lerp(CARET.w, MARK.w, t);
    const h = lerp(CARET.h, MARK.h, t);
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    svg.setAttribute(
      "stroke-width",
      String(lerp(CARET.stroke, MARK.stroke, t)),
    );
    svg.style.width = `${lerp(CARET.width, MARK.width, t)}em`;
  }

  /* The path's `d` is owned here, not by the template, so a tween in flight
     is not overwritten by the next render. The svg is rebuilt on every beat,
     and a new one starts at rest on whichever side it is now. */
  $effect(() => {
    if (!svg || !shape || !icon) return;
    const to = idle ? 1 : 0;
    const d = iconPath(idle ? icon : "caret");
    const fresh = !shape.getAttribute("d");
    gsap.killTweensOf([prog, shape]);
    if (fresh || reducedMotion()) {
      prog.t = to;
      apply();
      shape.setAttribute("d", d);
      return;
    }
    const opts = { duration: 0.32, ease: "power2.inOut" };
    gsap.to(shape, { morphSVG: d, ...opts });
    gsap.to(prog, { t: to, ...opts, onUpdate: apply });
  });
</script>

{#key beat}
  <svg
    bind:this={svg}
    class="caret"
    class:idle
    class:morphs={!!icon}
    data-side={side}
    viewBox="2 2 4 20"
    fill="none"
    stroke="currentColor"
    stroke-width="2.9"
    stroke-linecap="round"
    aria-hidden="true"
  >
    {#if icon}
      <path bind:this={shape} />
    {:else}
      {#each shapes("caret") as [tag, attrs]}
        <svelte:element this={tag} {...attrs} />
      {/each}
    {/if}
  </svg>
{/key}

<style>
  .caret {
    --ink: 0.0834em;
    --gap: 0.06em;
    flex: none;
    display: inline-block;
    width: 0.23em;
    height: 1.15em;
    vertical-align: text-bottom;
    overflow: visible;
    animation: caret-beat 1.2s infinite;
  }
  .caret.morphs {
    transition:
      color 0.32s ease,
      translate 0.32s ease;
  }
  .caret.idle {
    color: var(--muted);
    animation: none;
    translate: 0 0;
  }
  /* The stroke is --ink wide either side of the point it is centred on, so
     stepping by --ink puts its edge on the point and --gap more leaves air
     between it and the letter. */
  .caret[data-side="tail"] {
    translate: calc(var(--ink) + var(--gap)) 0;
  }
  .caret[data-side="lead"] {
    translate: calc(-1 * (var(--ink) + var(--gap))) 0;
  }
  .caret[data-side="bare"] {
    translate: var(--ink) 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
    .caret.morphs {
      transition: none;
    }
  }
</style>
