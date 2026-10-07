<script lang="ts">
  import { onMount } from "svelte";
  import { gsap, reducedMotion } from "../motion/gsap";
  import Icon from "./Icon.svelte";

  let {
    onclear,
  }: {
    /**
     * Given a way to clear the filter, the ghost waits out a pause, eats the
     * line left to right and clears it on swallowing the last letter. Remount per
     * query (`{#key}`) so typing restarts the wait.
     */
    onclear?: () => void;
  } = $props();

  const LETTERS = [..."NO MATCHES"];
  /** Long enough that someone still typing never loses a query mid-word. */
  const PAUSE = 1.6;
  /** px per second. */
  const SPEED = 110;

  let box: HTMLElement;
  let ghost: HTMLElement;
  let hunting = $state(false);

  onMount(() => {
    if (!onclear || reducedMotion()) return;
    const letters = [...box.querySelectorAll<HTMLElement>(".ch")];
    const last = letters.at(-1);
    if (!last) return;
    const start = ghost.getBoundingClientRect();
    const run = last.getBoundingClientRect().right - start.right;
    if (run <= 0) return;

    const duration = Math.min(2, Math.max(0.5, run / SPEED));
    const mouth = start.left + start.width / 2;
    const tl = gsap.timeline({ delay: PAUSE, onComplete: onclear });
    tl.call(() => (hunting = true), [], 0);
    tl.to(
      ghost,
      {
        x: run,
        duration,
        ease: `steps(${Math.max(4, Math.round(run / (start.width / 3)))})`,
      },
      0,
    );
    for (const letter of letters) {
      const at =
        ((letter.getBoundingClientRect().left - mouth) / run) * duration;
      tl.set(letter, { visibility: "hidden" }, Math.max(0, at));
    }
    return () => tl.kill();
  });
</script>

<p class="none" bind:this={box}>
  <span class="ghost" class:hunting bind:this={ghost}
    ><Icon name="noMatch" size="1.5em" label="no matches" /></span
  >
  <span class="word" aria-hidden="true"
    >{#each LETTERS as letter}<span class="ch">{letter}</span>{/each}</span
  >
</p>

<style>
  .none {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-2);
    margin: 0;
    padding: var(--pad-3);
    overflow: hidden;
    font-size: var(--fs-md);
    letter-spacing: 0.08em;
    white-space: pre;
    color: var(--muted);
  }
  .ghost {
    flex: none;
    position: relative;
    z-index: 1;
    display: inline-flex;
  }
  .ghost.hunting {
    color: var(--accent);
  }
</style>
