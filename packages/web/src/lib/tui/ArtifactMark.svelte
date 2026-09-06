<script lang="ts">
  /**
   * Three rings on an equilateral triangle, centred on the rotation point.
   *
   * The centroid sits at (50,50) rather than where a bounding-box centring
   * would put it, because this mark spins: the swept circle has to be centred,
   * or the triangle orbits the middle instead of turning in place.
   *
   * `spread` is the circumradius. Growing it moves the rings apart without
   * touching their radius — which is the whole point, since the frame around
   * them scales and the rings must not.
   */
  let {
    size = "1em",
    spread = 30,
    weight = 6,
  }: { size?: string; spread?: number; weight?: number } = $props();

  const S = Math.sqrt(3) / 2;
  /** Unit vectors to the three vertices, apex up. */
  const DIRS: [number, number][] = [
    [0, -1],
    [-S, 0.5],
    [S, 0.5],
  ];
</script>

<svg
  class="mark"
  viewBox="0 0 100 100"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={weight}
  role="presentation"
  aria-hidden="true"
>
  {#each DIRS as [dx, dy]}
    <!-- Filled from the same currentColor as the stroke, so each ring reads as
         one disc rather than an outline with a tint behind it. -->
    <circle
      cx={50 + dx * spread}
      cy={50 + dy * spread}
      r="16"
      fill="currentColor"
      fill-opacity="0.28"
    />
  {/each}
</svg>

<style>
  .mark {
    flex: none;
    display: block;
    overflow: visible;
  }
</style>
