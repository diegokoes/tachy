<script lang="ts">
  import { ICONS, type IconName } from "./icons";

  let {
    name,
    size = "1.25em",
    weight = 6,
    label,
    el = $bindable(),
  }: {
    name: IconName;
    size?: string;
    /** Stroke thickness as a percentage of the grid, so it reads the same on both. */
    weight?: number;
    label?: string;
    el?: SVGSVGElement;
  } = $props();

  const def = $derived(ICONS[name]);
  const grid = $derived(def.grid ?? 100);
  const scale = $derived(grid / 100);
</script>

<svg
  bind:this={el}
  class="icon"
  viewBox="0 0 {grid} {grid}"
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
  {@html def.path}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
    overflow: visible;
  }
</style>
