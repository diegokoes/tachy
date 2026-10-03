import { gsap, reducedMotion, ScrollTrigger } from "../gsap";
import { wipeIn } from "../motion";
import { scrollport } from "../scrollport.svelte";

type Entry = {
  key: string;
  el: HTMLElement;
  head: HTMLElement;
  mount: () => void;
};

export type Spy = ReturnType<typeof createSpy>;

/**
 * The heading pins one --main-air below the scrollport, which is as high as a
 * sticky box can go inside `main`'s content box, so a section lands flush and
 * the heading is already where it will stay.
 */
const LANDING = 0;

/** How long a scroll keeps correcting itself after arriving, and the ceiling
    on extending that while panels are still loading in above it. */
const SETTLE = 500;
const SETTLE_CAP = 3000;

/**
 * The rail and the stacked column, kept in agreement.
 *
 * Sections register themselves as they mount; this builds one ScrollTrigger
 * per section against the app's real scroller and reports which one the reader
 * is in. It also owns the two other things that are really scroll position in
 * disguise — the once-only reveal, and mounting a section shortly before it is
 * reached.
 */
export function createSpy(opts: {
  onactive: (key: string) => void;
  order: () => string[];
}) {
  const entries = new Map<string, Entry>();
  let triggers: ScrollTrigger[] = [];
  let observer: ResizeObserver | null = null;
  let refreshFrame = 0;
  let built = false;

  /* Set while a rail click or a deep-link jump is driving the scroll. The spy
     fires all the way down a programmatic scroll, and every one of those
     firings would rewrite the URL and relight the rail on a section the reader
     is only passing through. */
  let programmatic = false;
  let trip: gsap.core.Tween | null = null;
  let holding = 0;
  let holdUntil = 0;
  let holdCap = 0;

  /* Trailing air under the last section. Without it a short last section can
     never reach the top — there is nothing below to scroll — so where the rail
     puts you would depend on how many rows the table happened to have. */
  let tail = $state(0);

  const port = () => scrollport();

  /** The registered sections in page order, skipping any not yet in the DOM. */
  const ordered = () =>
    opts
      .order()
      .map((k) => entries.get(k))
      .filter((e): e is Entry => Boolean(e));

  function atBottom(el: HTMLElement) {
    return el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
  }

  function build() {
    const el = port();
    if (!el) return;
    kill();
    built = true;

    for (const e of ordered()) {
      triggers.push(
        ScrollTrigger.create({
          trigger: e.el,
          scroller: el,
          start: "top bottom+=600",
          once: true,
          onEnter: () => e.mount(),
        }),
      );

      triggers.push(
        ScrollTrigger.create({
          trigger: e.el,
          scroller: el,
          start: "top 35%",
          end: "bottom 35%",
          onToggle: (self) => {
            if (!self.isActive || programmatic) return;
            /* Same edge rule as onScroll below, applied here because a toggle
               fires without a scroll event to correct it afterwards. A first
               section shorter than a third of the window puts the 35% line over
               its neighbour before the reader has scrolled at all, which lit
               the second row of the rail on arrival and wrote its name into the
               URL. */
            if (el.scrollTop <= 2 && ordered()[0]?.key !== e.key) return;
            opts.onactive(e.key);
          },
        }),
      );

      if (!reducedMotion()) {
        triggers.push(
          ScrollTrigger.create({
            trigger: e.el,
            scroller: el,
            start: "top 85%",
            once: true,
            onEnter: () => reveal(e),
          }),
        );
      }
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* The 35% line is the wrong test at either end of the scroll: an overview
     shorter than a third of the window puts the line over the section below it
     while the reader is plainly looking at the overview, and a short last
     section never reaches the line at all. */
  function onScroll() {
    const el = port();
    if (!el || programmatic) return;
    if (el.scrollTop <= 2) {
      const first = ordered()[0];
      if (first) opts.onactive(first.key);
    } else if (atBottom(el)) {
      const last = ordered().at(-1);
      if (last) opts.onactive(last.key);
    }
  }

  /* The scroll has arrived, but the panels above it are still fetching, and
     each one that lands pushes the target further down. So the hold does not
     run on a fixed timer: every resize of the column extends it, up to a cap,
     and it ends the instant the reader scrolls for themselves — which is the
     whole difference between settling and scroll-jacking. */
  function hold(el: HTMLElement, goal: () => number) {
    const give = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const stop = () => {
      cancelAnimationFrame(holding);
      holding = 0;
      programmatic = false;
      for (const ev of give) el.removeEventListener(ev, stop);
      window.removeEventListener("keydown", stop);
    };
    for (const ev of give)
      el.addEventListener(ev, stop, { passive: true, once: true });
    window.addEventListener("keydown", stop, { once: true });

    holdUntil = performance.now() + SETTLE;
    holdCap = performance.now() + SETTLE_CAP;
    const tick = () => {
      if (!holding) return;
      const want = goal();
      if (Math.abs(el.scrollTop - want) > 1) el.scrollTop = want;
      if (performance.now() < holdUntil) holding = requestAnimationFrame(tick);
      else stop();
    };
    holding = requestAnimationFrame(tick);
  }

  function release() {
    trip?.kill();
    trip = null;
    cancelAnimationFrame(holding);
    holding = 0;
    programmatic = false;
  }

  /* clearProps is load-bearing, not tidiness: `from` leaves its transform
     inline when it lands, and a transformed ancestor becomes the containing
     block for every `position: fixed` inside it — which trapped a dialog's
     scrim and its own stacking order inside this one section. */
  function reveal(e: Entry) {
    wipeIn([e.head]);
    gsap.from(e.el.querySelector(".section-body") ?? e.el, {
      opacity: 0,
      y: 14,
      duration: 0.35,
      ease: "power2.out",
      clearProps: "transform,opacity",
    });
  }

  function measureTail() {
    const el = port();
    const last = ordered().at(-1);
    if (!el || !last) return;
    const next = Math.max(0, el.clientHeight - last.el.offsetHeight);
    if (Math.abs(next - tail) > 1) tail = next;
  }

  function refresh() {
    if (holding) holdUntil = Math.min(holdCap, performance.now() + SETTLE);
    cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => {
      measureTail();
      ScrollTrigger.refresh();
    });
  }

  function kill() {
    port()?.removeEventListener("scroll", onScroll);
    for (const t of triggers) t.kill();
    triggers = [];
  }

  return {
    register(
      key: string,
      el: HTMLElement,
      head: HTMLElement,
      mount: () => void,
    ) {
      entries.set(key, { key, el, head, mount });
      if (built) refresh();
      return () => {
        if (entries.get(key)?.el === el) entries.delete(key);
      };
    },

    /** Called once the page's sections are all in the DOM. */
    start() {
      const el = port();
      if (!el) return;
      build();
      observer = new ResizeObserver(refresh);
      observer.observe(el);
      for (const e of ordered()) observer.observe(e.el);
      measureTail();
    },

    /**
     * Scroll to a section.
     *
     * Everything above the target is mounted first, but that is only half the
     * problem: a panel renders an empty table and then grows again when its
     * fetch lands, which on a page this tall happens while the scroll is still
     * travelling. So the destination is re-measured on every tick rather than
     * recorded once, and held for a moment after arrival — until the reader
     * touches the scroll themselves.
     */
    goto(key: string, animate = true) {
      const el = port();
      const target = entries.get(key);
      if (!el || !target) return;

      for (const e of ordered()) {
        e.mount();
        if (e.key === key) break;
      }
      opts.onactive(key);

      release();
      programmatic = true;

      /** Where the scroller has to be for the target to sit at the top. */
      const goal = () => {
        const offset =
          el.scrollTop +
          target.el.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          LANDING;
        return Math.max(0, Math.min(offset, el.scrollHeight - el.clientHeight));
      };

      requestAnimationFrame(() => {
        ScrollTrigger.refresh();
        if (!animate || reducedMotion()) {
          el.scrollTop = goal();
          hold(el, goal);
          return;
        }
        const from = el.scrollTop;
        const box = { p: 0 };
        trip = gsap.to(box, {
          p: 1,
          duration: 0.55,
          ease: "power2.inOut",
          onUpdate: () => (el.scrollTop = from + (goal() - from) * box.p),
          onComplete: () => hold(el, goal),
        });
      });
    },

    refresh,

    /** Height of the spacer the page has to draw under its last section. */
    get tail() {
      return tail;
    },

    destroy() {
      cancelAnimationFrame(refreshFrame);
      release();
      observer?.disconnect();
      observer = null;
      built = false;
      kill();
      /* Entries are not cleared: on a page change the incoming sections
         register before this runs, and each outgoing one removes its own
         through the disposer `register` handed it. */
    },
  };
}
