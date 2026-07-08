<script lang="ts">
  // Boot ident: a spiral galaxy of small characters spins and drains into the
  // five letter slots of "tachý" — most chars shrink to dust and evaporate on
  // arrival, while one copy plucked from mid-spiral elastically pops into
  // place to spell the word. The rotation completes just before the word
  // becomes legible, so it settles upright. Click/Escape skips.
  import { onMount } from "svelte";
  import { gsap, SplitText } from "./gsap";

  let { onDone }: { onDone: () => void } = $props();

  // Stacked word copies forming the spiral; one mid-spiral copy becomes the logo.
  const COPIES = 120;

  let root = $state<HTMLDivElement>();
  let tl: gsap.core.Timeline | undefined;

  function skip() {
    tl?.progress(1);
  }

  onMount(() => {
    const q = gsap.utils.selector(root!);
    const split = new SplitText(q(".line"), { type: "chars" });
    const chars = split.chars;
    const N = chars.length;
    const perWord = N / COPIES;
    const charW = chars[0].getBoundingClientRect().width;
    const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.34;
    // Transforms are relative to each char's inline slot; subtracting the slot
    // offset places chars in screen space around the word's center.
    const slot = (i: number) => ((i % perWord) - (perWord - 1) / 2) * charW;

    // The copy that survives to spell the word — mid-spiral, so its letters
    // visibly fly out of the formation into place.
    const s0 = Math.floor(COPIES / 2) * perWord;
    const survivors = chars.slice(s0, s0 + perWord);
    const extras = chars.slice(0, s0).concat(chars.slice(s0 + perWord));

    // Spiral galaxy: radius grows with index, 5rad angle steps scatter the arms.
    gsap.set(chars, {
      x: (i: number) => (20 + (maxR - 20) * (i / N)) * Math.cos(i * 5) - slot(i),
      y: (i: number) => (20 + (maxR - 20) * (i / N)) * Math.sin(i * 5),
      scale: (i: number) => 0.2 + (i / N) * 0.25,
    });
    gsap.set(survivors, { zIndex: 2 });

    tl = gsap.timeline({ onComplete: onDone });
    tl.to(q(".word"), { opacity: 1, duration: 0.45, ease: "power2.out" })
      // one revolution, finishing before the word is legible so it lands upright
      .to(q(".word"), { rotation: 360, duration: 3.2, ease: "power1.inOut" }, 0.15)
      // x/y 0 is each char's letter slot: the whole spiral streams into the
      // word, but extras shrink to dust and evaporate as they arrive — they
      // feed the letters without ever stacking into a bold blob
      .to(
        extras,
        {
          x: 0,
          y: 0,
          scale: 0.12,
          opacity: 0,
          duration: 1.6,
          ease: "power1.in",
          stagger: 0.002,
        },
        0.7,
      )
      // the surviving copy pops to full size in the emptying slots
      .to(
        survivors,
        { x: 0, y: 0, scale: 1, ease: "elastic.out(1, 0.55)", duration: 2.4, stagger: 0.05 },
        2.2,
      )
      .to(q(".footer"), { opacity: 1, duration: 0.5 }, 4.3)
      .to(root!, { opacity: 0, duration: 0.5 }, "+=0.7");

    return () => {
      tl?.kill();
      split.revert();
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
  <div class="word">
    {#each { length: COPIES } as _}
      <div class="line">tachý</div>
    {/each}
  </div>
  <div class="footer">knowledge archive and engine</div>
</div>

<style>
  .splash {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2.25rem;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
  }

  .word {
    display: grid;
    place-items: center;
    opacity: 0;
    color: var(--accent);
    font-size: clamp(2.25rem, 5vw, 3.25rem);
    line-height: 1.05;
    font-kerning: none;
  }

  /* All copies stack in one grid cell; transforms fan the chars out from it. */
  .line {
    grid-area: 1 / 1;
    white-space: nowrap;
  }

  .footer {
    opacity: 0;
    color: var(--muted);
    font-size: 0.95rem;
    letter-spacing: 0.18em;
  }
</style>
