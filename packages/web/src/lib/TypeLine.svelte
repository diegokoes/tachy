<script lang="ts">
  // Types a line of text character by character while a solid block handle
  // sweeps across (stepped, terminal-style), then stays behind it blinking.
  import { onMount } from "svelte";
  import { gsap, SplitText, reducedMotion } from "./gsap";

  let { text }: { text: string } = $props();

  let p = $state<HTMLParagraphElement>();
  let handle = $state<HTMLSpanElement>();

  onMount(() => {
    if (reducedMotion()) return;
    const split = new SplitText(p!, { type: "chars" });
    const n = split.chars.length;
    const width = p!.getBoundingClientRect().width;
    const typeTime = n * 0.03;

    const tl = gsap.timeline();
    tl.from(split.chars, { autoAlpha: 0, duration: 0.001, stagger: 0.03 }, 0)
      .to(handle!, { x: width, duration: typeTime, ease: `steps(${n})` }, 0)
      .fromTo(handle!, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, repeat: -1, yoyo: true });

    return () => {
      tl.kill();
      split.revert();
    };
  });
</script>

<span class="typeline">
  <p bind:this={p}>{text}</p>
  <span class="handle" bind:this={handle} aria-hidden="true"></span>
</span>

<style>
  .typeline { position: relative; display: inline-block; }
  p { margin: 0; white-space: nowrap; }
  .handle {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 0.55em;
    height: 1.15em;
    background: var(--accent);
  }
</style>
