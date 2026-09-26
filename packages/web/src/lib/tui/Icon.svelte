<script lang="ts">
  import { gsap, reducedMotion } from "../gsap";
  import { GRID, iconPath, shapes, type IconName } from "./icons";

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
    /**
     * For a mark that carries meaning on its own. Rendered as visually hidden
     * text rather than an aria-label, which some screen readers skip and
     * translation tools leave untranslated. An icon inside a control stays
     * unlabelled: the control carries the name.
     */
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
  aria-hidden="true"
  style="--sw-hover: {9 * scale}"
>
  {#if morph}
    <path bind:this={shape} />
  {:else}
    {#each shapes(name) as [tag, attrs]}
      <svelte:element this={tag} {...attrs} />
    {/each}
  {/if}
</svg>
{#if label}<span class="label">{label}</span>{/if}

<style>
  .icon {
    flex: none;
    display: block;
    overflow: visible;
  }

  /* No negative margin: with one, some screen readers read the text ahead of
     its neighbours. */
  .label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
