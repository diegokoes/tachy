<script lang="ts">
  /**
   * The Azure DevOps logo, in its own colours. It lives outside ICONS, which
   * holds stroke-only marks in the text colour.
   */
  let { size = "1.1em", label }: { size?: string; label?: string } = $props();

  // Gradient ids are document-wide: two marks on a page must not share one.
  const uid = $props.id();
  const gradientId = `ado-${uid}`;
</script>

<svg
  class="ado"
  viewBox="0 0 18 18"
  width={size}
  height={size}
  role={label ? "img" : "presentation"}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
>
  <defs>
    <linearGradient
      id={gradientId}
      x1="9"
      y1="16.97"
      x2="9"
      y2="1.03"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" stop-color="#0078d4" />
      <stop offset="0.16" stop-color="#1380da" />
      <stop offset="0.53" stop-color="#3c91e5" />
      <stop offset="0.82" stop-color="#559cec" />
      <stop offset="1" stop-color="#5ea0ef" />
    </linearGradient>
  </defs>
  <path
    d="M17,4v9.74l-4,3.28-6.2-2.26V17L3.29,12.41l10.23.8V4.44Zm-3.41.49L7.85,1V3.29L2.58,4.84,1,6.87v4.61l2.26,1V6.57Z"
    fill="url(#{gradientId})"
  />
</svg>

<style>
  .ado {
    flex: none;
    display: block;
  }
</style>
