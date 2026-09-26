<script lang="ts">
  import { gsap, reducedMotion } from "../gsap";
  import { GRID, ICONS, iconPath, type IconName } from "./icons";

  let {
    name,
    size = "1.25em",
    weight = 6,
    label,
    morph = false,
    el = $bindable(),
  }: {
    name: IconName;
    size?: string;
    /** Stroke thickness as a percentage of the grid. */
    weight?: number;
    label?: string;
    /**
     * Tween the outline from one mark to the next when `name` changes — trash
     * into the check that confirms it, an eye opening and shutting.
     */
    morph?: boolean;
    el?: SVGSVGElement;
  } = $props();

  const scale = GRID / 100;

  let shape: SVGPathElement | undefined = $state();

  /* The path's `d` is owned here rather than by the template, so a tween in
     flight is not overwritten by Svelte on the next render. */
  $effect(() => {
    if (!shape) return;
    const d = iconPath(name);
    if (!shape.getAttribute("d") || reducedMotion()) {
      gsap.killTweensOf(shape);
      shape.setAttribute("d", d);
      return;
    }
    gsap.to(shape, {
      morphSVG: d,
      duration: 0.32,
      ease: "power2.inOut",
      overwrite: true,
    });
  });
</script>

<svg
  bind:this={el}
  class="icon"
  viewBox="0 0 {GRID} {GRID}"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={weight * scale}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? "img" : "presentation"}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
  style="--sw-hover: {9 * scale}"
>
  {#if morph}
    <path bind:this={shape} />
  {:else}
    {@html ICONS[name].path}
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
    overflow: visible;
  }
</style>
