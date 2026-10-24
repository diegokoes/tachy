<script lang="ts">
  import { onMount } from "svelte";
  import { gsap, SplitText, reducedMotion } from "./gsap";

  let {
    text,
    caret = true,
    withinMs,
    ondone,
  }: {
    text: string;
    caret?: boolean;
    /** The whole line types within this long; a long line types faster. */
    withinMs?: number;
    /** The line is fully typed: at once under reduced motion. */
    ondone?: () => void;
  } = $props();

  let paragraph = $state<HTMLParagraphElement>();
  let handle = $state<HTMLSpanElement>();

  onMount(() => {
    if (reducedMotion()) return ondone?.();
    const split = new SplitText(paragraph!, { type: "chars" });
    const n = split.chars.length;
    const width = paragraph!.getBoundingClientRect().width;
    const charSeconds = withinMs ? Math.min(0.03, withinMs / 1000 / n) : 0.03;
    const typeTime = n * charSeconds;

    const tl = gsap.timeline();
    tl.from(
      split.chars,
      { autoAlpha: 0, duration: 0.001, stagger: charSeconds },
      0,
    );
    if (ondone) tl.call(ondone, undefined, typeTime);
    if (handle)
      tl.to(
        handle,
        { x: width, duration: typeTime, ease: `steps(${n})` },
        0,
      ).fromTo(
        handle,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.4, repeat: -1, yoyo: true },
      );

    return () => {
      tl.kill();
      split.revert();
    };
  });
</script>

<span class="typeline">
  <p bind:this={paragraph}>{text}</p>
  {#if caret}
    <span class="handle" bind:this={handle} aria-hidden="true"></span>
  {/if}
</span>

<style>
  .typeline {
    position: relative;
    display: inline-block;
  }
  p {
    margin: 0;
    white-space: nowrap;
  }
  .handle {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 0.55em;
    height: 1.15em;
    background: var(--accent-fill);
  }
</style>
