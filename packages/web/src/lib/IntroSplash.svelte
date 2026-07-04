<script lang="ts">
  // Boot ident: accent ring + typed "tachy", then the ring blows past the
  // viewport to reveal the app. Click skips it.
  import { onMount } from "svelte";
  import { gsap, SplitText } from "./gsap";

  let { onDone }: { onDone: () => void } = $props();

  let root = $state<HTMLDivElement>();
  let tl: gsap.core.Timeline | undefined;

  function skip() {
    tl?.progress(1);
  }

  onMount(() => {
    const q = gsap.utils.selector(root!);
    const word = new SplitText(q(".word"), { type: "chars" });

    tl = gsap.timeline({ onComplete: onDone });
    tl.from(q(".glow"), { opacity: 0, filter: "blur(0px)", duration: 0.55, ease: "power3.inOut" })
      .set(q(".logo"), { opacity: 1 })
      .from(word.chars, {
        opacity: 0, scale: 1.4, filter: "blur(0.3em)",
        duration: 0.2, stagger: 0.045, ease: "back",
      })
      .from(q(".ring"), { opacity: 0, scale: 0.75, duration: 0.4, ease: "power3.out" }, "-=100%")
      .from(q(".ring-inner"), { scale: 0.75, duration: 0.4, ease: "power3.out" }, "-=100%")
      .to(q(".logo"), { scale: 1.08, duration: 1.1 }, "-=20%")
      .to([q(".ring"), q(".ring-inner")], { scale: 1.08, duration: 1.1, ease: "power3.out" }, "<")
      .to(q(".ring"), { scale: 9, duration: 1.0, ease: "power4.in" }, "-=50%")
      .to(q(".ring-inner"), { scale: 9, duration: 0.5, ease: "power4.in" }, "-=60%")
      .to(q(".logo"), { opacity: 0, scale: 1.15, duration: 0.25 }, "-=50%")
      .to(root!, { opacity: 0, duration: 0.3 }, "-=20%");

    return () => {
      tl?.kill();
      word.revert();
    };
  });
</script>

<div
  class="splash"
  bind:this={root}
  onclick={skip}
  onkeydown={(e) => e.key === "Escape" && skip()}
  role="presentation"
  aria-hidden="true"
>
  <div class="glow top"></div>
  <div class="glow bottom"></div>
  <div class="logo">
    <div class="ring centered"></div>
    <div class="ring-inner centered"></div>
    <div class="text">
      <div class="word">tachy</div>
    </div>
  </div>
</div>

<style>
  .splash {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
  }

  .centered {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }

  /* Soft monochrome accent washes instead of the neon gradient bars. */
  .glow {
    position: absolute;
    left: -5%;
    width: 110%;
    height: 90px;
    filter: blur(3em);
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--accent) 28%, transparent) 0% 15%,
      transparent 15% 45%,
      color-mix(in srgb, var(--accent) 18%, transparent) 45% 75%,
      transparent 75%
    );
  }
  .glow.top { top: -50px; }
  .glow.bottom { bottom: -50px; }

  .logo { position: relative; opacity: 0; }

  .ring {
    background: var(--accent);
    border-radius: 1.4em;
    width: 150%;
    height: 175%;
    z-index: 1;
  }

  .ring-inner {
    background: var(--bg);
    border-radius: 1.2em;
    width: calc(150% - 0.4em);
    height: calc(175% - 0.4em);
    z-index: 2;
  }

  .text { position: relative; z-index: 3; text-align: center; }

  .word {
    color: var(--accent);
    font-size: clamp(4rem, 10vw, 7rem);
    line-height: 1.05;
    letter-spacing: 0.02em;
  }

</style>
