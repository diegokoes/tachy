<script lang="ts" generics="T extends string | number">
  import { gsap, reducedMotion } from "../motion/gsap";
  import { Icon, tip, type IconName } from "../tui";

  let {
    options,
    value,
    label,
    onpick,
  }: {
    /** With an icon the option draws only it, its label the tip and name. */
    options: readonly { value: T; label: string; icon?: IconName }[];
    value: T;
    /** Names the group for a screen reader. */
    label: string;
    onpick: (value: T) => void;
  } = $props();

  let group = $state<HTMLElement>();
  let fill = $state<HTMLElement>();
  let placed = false;

  // One fill that travels to the picked option, rather than each option
  // painting its own: a shared shape moving says "this one instead of that
  // one", which three backgrounds swapping at once does not.
  function place(animate: boolean) {
    const at = group?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!fill || !at) return;
    const to = { x: at.offsetLeft, width: at.offsetWidth };
    if (animate && placed && !reducedMotion())
      gsap.to(fill, { ...to, duration: 0.32, ease: "power3.out" });
    else gsap.set(fill, to);
    placed = true;
  }

  $effect(() => {
    value;
    place(true);
  });

  $effect(() => {
    if (!group) return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(group);
    return () => ro.disconnect();
  });
</script>

<div
  class="choice"
  class:icons={options.some((o) => o.icon)}
  role="radiogroup"
  aria-label={label}
  bind:this={group}
>
  <span class="fill" aria-hidden="true" bind:this={fill}></span>
  {#each options as o (o.value)}
    {#if o.icon}
      <button
        type="button"
        role="radio"
        aria-checked={o.value === value}
        aria-label={o.label}
        class:on={o.value === value}
        use:tip={o.label}
        onclick={() => onpick(o.value)}
        ><Icon name={o.icon} size="1em" /></button
      >
    {:else}
      <button
        type="button"
        role="radio"
        aria-checked={o.value === value}
        class:on={o.value === value}
        onclick={() => onpick(o.value)}>{o.label}</button
      >
    {/if}
  {/each}
</div>

<style>
  .choice {
    position: relative;
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(4.5rem, auto);
    align-self: center;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .choice.icons {
    grid-auto-columns: minmax(2rem, auto);
  }
  .choice.icons button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--pad-2);
  }
  .fill {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    border-radius: calc(var(--radius-control) - 3px);
    background: var(--accent-dim);
    box-shadow: inset 0 0 0 1px
      color-mix(in srgb, var(--accent) 35%, transparent);
    pointer-events: none;
  }
  button {
    position: relative;
    min-height: calc(var(--row-h) - 6px);
    padding: 0 var(--pad-3);
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--muted);
    background: none;
    border: none;
    border-radius: calc(var(--radius-control) - 3px);
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.25s ease;
  }
  button:hover {
    color: var(--text);
  }
  button.on {
    color: var(--accent);
  }
  button:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
</style>
