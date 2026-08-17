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
    weight?: number;
    label?: string;
    el?: SVGSVGElement;
  } = $props();
</script>

<svg
  bind:this={el}
  class="icon"
  viewBox="0 0 100 100"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={weight}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? "img" : "presentation"}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
>
  {@html ICONS[name]}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
    overflow: visible;
  }
</style>
