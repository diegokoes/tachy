<script lang="ts">
  import { onMount } from "svelte";
  import ChatView from "./lib/ChatView.svelte";
  import LibraryView from "./lib/library/LibraryView.svelte";
  import AdminView from "./lib/admin/AdminView.svelte";
  import SettingsView from "./lib/settings/SettingsView.svelte";
  import IntroSplash from "./lib/IntroSplash.svelte";
  import SetupWizard from "./lib/SetupWizard.svelte";
  import LoginView from "./lib/LoginView.svelte";
  import { session, initSession } from "./lib/session.svelte";
  import { navItems } from "./lib/nav.svelte";
  import { reducedMotion } from "./lib/gsap";
  import { wipeIn } from "./lib/motion";
  import StarField from "./lib/StarField.svelte";
  import Wordmark from "./lib/Wordmark.svelte";
  import { loadThemeFromStorage } from "./lib/theme.svelte";
  import { loadFonts } from "./lib/fonts.svelte";
  import { navigate, section, startRouter } from "./lib/router.svelte";
  import { hints, pushScope, startKeys } from "./lib/keys.svelte";
  import { navKey } from "./lib/keys/bindings.svelte";
  import { loadVim, vimState, scrollBindings } from "./lib/vim.svelte";
  import { subnav, topActions } from "./lib/subnav.svelte";
  import { HintRule, Panel, Scrollbar, Tabs } from "./lib/tui";

  const nav = $derived(navItems());

  const view = $derived(section("chat"));

  const sub = $derived(subnav());

  let wizardSkipped = $state(localStorage.getItem("tachy-skip-wizard") === "1");
  const showWizard = $derived(session.bootstrapped === false && !wizardSkipped);
  const showLogin = $derived(
    session.bootstrapped !== false &&
      !session.me &&
      Boolean(session.config?.passwordLogin || session.config?.sso),
  );

  function skipWizard() {
    wizardSkipped = true;
    localStorage.setItem("tachy-skip-wizard", "1");
  }

  let splash = $state(!reducedMotion());
  let navEl = $state<HTMLElement>();
  let mainEl = $state<HTMLElement>();
  let navRevealed = $state(false);
  let subEl = $state<HTMLElement>();
  let windowEl = $state<HTMLElement>();
  let subH = $state(0);
  let settling = $state(false);
  let carveMask = $state("none");
  let carveOutline = $state("");
  let carveW = $state(0);
  let carveH = $state(0);

  /** Resolves a CSS length in an element's own context, tokens and all. */
  function cssPx(host: HTMLElement, value: string): number {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;height:0;width:${value}`;
    host.appendChild(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }

  /**
   * The recess outline, as one path.
   *
   * The recess opens at the window's own left edge and runs right to `wall`,
   * which comes from the window rather than the bar: to within `--sub-reserve`
   * of the right edge, leaving a corner for the row's own content, falling
   * back to clearing the centred bar only when the window is too narrow for
   * that.
   *
   * So the left end is not a mouth but the window's top-left corner, moved
   * down to the recess floor and rounded like every other corner on the box.
   * The right end keeps the floor's inward round and a mouth that rounds
   * outward, so the window's top rule sweeps down into the recess instead of
   * stopping at a square shoulder. A CSS border cannot turn that way, which is
   * why the outline is stroked from the same path the mask is filled from —
   * generating them separately is how a cut and the line drawn on it drift
   * apart.
   *
   * `x0` / `y0` pull the open ends in: the stroke is centred on the path, so
   * starting it half a line-width inside lands it exactly on the window's own
   * left and top rules.
   */
  function recessPath(
    wall: number,
    h: number,
    round: number,
    x0: number,
    y0: number,
  ) {
    // Two decimals: sub-pixel is plenty, and the raw floats triple the length
    // of the data URI this ends up inside.
    const n = (v: number) => Math.round(v * 100) / 100;
    return [
      `M${n(x0)} ${n(h + round)}`,
      `Q${n(x0)} ${n(h)} ${n(x0 + round)} ${n(h)}`,
      `L${n(wall - round)} ${n(h)}`,
      `Q${n(wall)} ${n(h)} ${n(wall)} ${n(h - round)}`,
      `L${n(wall)} ${n(y0 + round)}`,
      `Q${n(wall)} ${n(y0)} ${n(wall + round)} ${n(y0)}`,
    ].join(" ");
  }

  /* Measured, not guessed. The recess is cut to the bar's size and the content
     below has to clear it — but the bar's box moves with the text size AND with
     whichever interface font is picked, so hardcoded rems would drift out of
     true the moment someone changed either. The tokens are resolved through the
     window itself for the same reason: they stay the single source of truth. */
  $effect(() => {
    const host = windowEl;
    const el = subEl;
    if (!host || !el) {
      subH = 0;
      carveMask = "none";
      carveOutline = "";
      return;
    }

    let last = "";
    const read = () => {
      const w = el.offsetWidth;
      const h0 = el.offsetHeight;
      const avail = host.clientWidth;
      // Nothing to redraw unless an input actually moved. Also the belt and
      // braces against a ResizeObserver loop, since this writes state the
      // observed elements can be laid out from.
      const sig = `${w}:${h0}:${avail}`;
      if (!w || !h0 || sig === last) return;
      last = sig;

      subH = h0;

      const air = cssPx(host, "var(--sub-air)");
      const line = cssPx(host, "var(--panel-line-w)");
      const reserve = cssPx(host, "var(--sub-reserve)");
      // The bar's own radius, so the two read as the same family of corner.
      const round = cssPx(host, "var(--radius)");

      // Open to within `reserve` of the right edge, but never tighter than the
      // centred bar's own right edge plus its air — which is what happens on a
      // window too narrow for both.
      const wall = Math.max(avail / 2 + w / 2 + air, avail - reserve);
      const h = h0 + air;
      carveW = wall + round;
      carveH = h + round + line;

      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${carveW}" height="${carveH}">` +
        `<path d="${recessPath(wall, h, round, 0, 0)} L0 0 Z" fill="black"/></svg>`;
      carveMask = `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
      carveOutline = recessPath(wall, h, round, line / 2, line / 2);
    };

    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    ro.observe(host);
    return () => ro.disconnect();
  });

  /* The subnav bar outlives a section change: an incoming view registers its
     tabs before the outgoing view's disposer runs — deliberately, so the row
     never blanks mid-switch — so the same element is reused and its indicator
     would slide from wherever the old section's tab happened to sit. Sliding
     is for moving within a section; arriving in one should just be there.

     Two frames, not one. The bar is centred, so the recess ResizeObserver
     writing a new width re-centres it a frame after the switch, and the
     indicator would take that second move as something to animate. */
  $effect(() => {
    void view;
    settling = true;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => (settling = false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  });

  $effect(() => {
    if (!navEl || splash || navRevealed) return;
    wipeIn(navEl.querySelectorAll("button"), () => (navRevealed = true));
  });

  // hidden: four more entries would crowd the hint rule, and Settings › keybinds
  // is the discovery surface for these now that the tabs no longer show digits.
  $effect(() => {
    const items = nav;
    return pushScope(
      items.map((n, i) => ({
        key: navKey(n.key, i),
        label: n.label,
        hidden: true,
        run: () => navigate(`/${n.key}`),
      })),
    );
  });

  // h/l walk the sections the digits jump to; ^d/^u page the main column.
  $effect(() => {
    if (!vimState.enabled) return;
    const items = nav;
    const at = items.findIndex((n) => n.key === view);
    const go = (delta: number) => () => {
      const next = items[Math.min(items.length - 1, Math.max(0, at + delta))];
      if (next && next.key !== view) navigate(`/${next.key}`);
    };
    return pushScope([
      { key: "h", label: "", hidden: true, run: go(-1) },
      { key: "l", label: "", hidden: true, run: go(1) },
      ...scrollBindings(() => mainEl),
    ]);
  });

  onMount(() => {
    loadThemeFromStorage();
    loadFonts();
    loadVim();
    initSession();
    const stopRouter = startRouter();
    const stopKeys = startKeys();
    return () => {
      stopRouter();
      stopKeys();
    };
  });
</script>

{#if splash}
  <IntroSplash onDone={() => (splash = false)} />
{/if}

<StarField />

{#if import.meta.env.VITE_DEV_BADGE}
  <div class="dev-badge">DEV</div>
{/if}

{#if session.loading}
  <!-- background only while the session resolves; the splash covers cold loads -->
{:else if showWizard}
  <SetupWizard onDone={() => {}} onSkip={skipWizard} />
{:else if showLogin}
  <LoginView />
{:else}
  <div class="app">
    <div class="topbar">
      <div class="mark"><Wordmark /></div>
      <div class="navbar" bind:this={navEl} class:unrevealed={!navRevealed}>
        <Panel>
          <Tabs
            items={nav}
            active={view}
            anchor="--tab-nav"
            onpick={(k) => navigate(`/${k}`)}
          />
        </Panel>
      </div>
      <!-- Balances the wordmark's track so the pill sits on the true centre. -->
      <div class="mark" aria-hidden="true"></div>
    </div>

    <div
      class="window"
      bind:this={windowEl}
      class:carved={sub}
      style="--sub-h-raw: {subH}px; --sub-mouth: {carveW}px; --sub-mask: {carveMask}"
    >
      <!-- Rendered before the window so its hotkey scope is pushed first and
           the view's scope stays innermost — otherwise this bar's (all hidden)
           bindings would sit on top and blank the hint rule. -->
      {#if sub}
        <svg
          class="notch"
          width={carveW}
          height={carveH}
          viewBox="0 0 {carveW} {carveH}"
          aria-hidden="true"
        >
          <path d={carveOutline} />
        </svg>
        <div class="subnav" class:settling bind:this={subEl}>
          <Tabs
            items={sub.items}
            active={sub.active}
            hotkeys="shift"
            anchor="--tab-sub"
            onpick={sub.onpick}
          />
        </div>
        {@const acts = topActions() ?? sub.actions}
        {#if acts}
          <div class="top-acts">{@render acts()}</div>
        {/if}
      {/if}

      <Panel grow>
        <div class="shell">
        <div class="content">
          <main id="main-content" bind:this={mainEl}>
            {#if view === "library"}
              <LibraryView />
            {:else if view === "admin"}
              <AdminView />
            {:else if view === "settings"}
              <SettingsView />
            {:else}
              <ChatView />
            {/if}
          </main>
          <Scrollbar target={mainEl} controls="main-content" />
        </div>

          <div class="hintrow">
            <HintRule hints={hints()} />
          </div>
        </div>
      </Panel>
    </div>
  </div>
{/if}

<style>
  /* Two objects on one centre line: a top row carrying the wordmark and the
     nav, and the window they sit above. The nav is no longer chrome bolted to
     a document — it reads as the object you steer the document with.

     The bottom gutter is the widest of the three: the window's lower edge is
     the one nothing else sits against, so it needs air to read as a floating
     object rather than as content jammed into the viewport. The gap is now the
     narrowest, for the opposite reason — the nav and the subnav in the recess
     below it are one control in two registers, and reading as a pair means
     sitting closer to each other than either does to anything else. */
  .app {
    position: relative;
    z-index: 1;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-3) clamp(0.75rem, 3vw, 2.5rem) var(--pad-4);
  }

  /* The cap is in px, not rem. max-width in rem multiplies by --font-scale, so
     picking a larger text size used to widen the box itself — at 175% it filled
     95% of a 1920 screen. Character count per line should track the text size;
     the frame around it should not. */
  .topbar,
  .window {
    width: 100%;
    max-width: min(86rem, 1600px);
    min-width: 0;
  }
  /* Positioning context for the subnav bar hung on its top edge. */
  .window {
    position: relative;
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .window > :global(section) {
    flex: 1;
    min-width: 0;
  }

  /* The floating surfaces let the sky through, just barely — enough that a
     star crossing behind them stays perceptible, not enough to cost any
     contrast against the text on top. Panels nested INSIDE keep --panel-bg
     opaque, so their inline titles still mask the rule they straddle. */
  .window > :global(section),
  .navbar :global(> section) {
    background: color-mix(in srgb, var(--panel-solid) 93%, transparent);
  }

  /* Three tracks, and the outer two are equal: the pill stays on the frame's
     true centre no matter how wide the wordmark draws. */
  .topbar {
    flex: none;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--gap);
  }
  .mark {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  /* Hugs its content rather than the frame, so it reads as a separate object
     floating above the window instead of a bar attached to it. */
  .navbar {
    display: flex;
    justify-content: center;
  }
  /* The subnav's box, not a Panel's default: the two bars sit on the same
     centre line and stacking a taller one above a shorter one read as two
     different objects rather than one control in two registers. */
  .navbar :global(> section) {
    width: max-content;
    max-width: 100%;
    padding: var(--pad-2) var(--pad-3);
  }
  /* The rule fills a full-width bar; a hugging pill has no edge to run to. */
  .navbar :global(.rule) {
    display: none;
  }

  /* Below this the pill needs the whole row; the wordmark is decoration and
     goes first. */
  @media (max-width: 52rem) {
    .topbar {
      grid-template-columns: 1fr;
    }
    .mark {
      display: none;
    }
  }

  /* The bar sits in a recess cut into the window's top edge, not on a bump
     above it. --sub-air is the empty space left around it inside the recess;
     the starfield shows through there, because the window's fill is genuinely
     removed rather than covered over.

     Prefixed: --drop is already a global token for the shadow colour, and
     redefining it here would silently swap a colour for a length everywhere
     inside the window. */
  .window {
    --sub-air: var(--pad-2);
    /* The air `main` keeps above and below its content. Named because a
       sticky child cannot rise above its containing block — `main`'s content
       box — so it pins this far down the scrollport and has to paint the
       strip left over it. See .bar in LibraryView. */
    --main-air: calc(var(--fs-xs) * 0.9);
    /* Right edge to recess wall: the corner the carved row keeps for its own
       content. The recess takes everything else, out to the left edge. */
    --sub-reserve: 15rem;
    --sub-depth: calc(var(--sub-h-raw, 0px) + var(--sub-air));
  }

  /* mask, not clip-path: clip-path would take the window's rounded corners off
     with it, since the polygon has to be square. Subtracting a shape leaves
     every other edge exactly as it was. */
  .window.carved > :global(section) {
    mask-image: var(--sub-mask, none), linear-gradient(#000 0 0);
    mask-size:
      auto,
      100% 100%;
    mask-position:
      top left,
      0 0;
    mask-repeat: no-repeat;
    mask-composite: exclude;
  }

  /* The mask removes the fill AND the rule along the cut, so the recess is
     drawn back in here: in off the top rule, down one side, across the floor,
     up the other and back out. Stroked rather than bordered because the mouth
     flares outward, and no CSS border can turn that way. */
  .notch {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    overflow: visible;
    pointer-events: none;
  }
  .notch path {
    fill: none;
    stroke: var(--muted);
    stroke-width: var(--panel-line-w);
  }

  /* No box of its own — the recess is the box. A second bordered pill hung
     under the nav's read as chrome about chrome; bare labels in a cut let the
     window's own edge do the framing, and cost the row a border and two steps
     of padding on the way. Its padding is what the Panel used to supply, so
     the labels still clear the recess floor.

     Centred on the window's centre line — the same one the nav pill sits on,
     so the two stack. */
  .subnav {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    padding: var(--pad-2) var(--pad-3);
  }
  /* The window's own top row, right of the recess — space the carve opens up
     and nothing else was using. Aligned to the Panel's content edge so it
     reads as part of the page, and capped short of the recess mouth so it can
     never collide with it. */
  .top-acts {
    position: absolute;
    top: 0;
    right: var(--pad-4);
    z-index: 2;
    /* The band down to where page content actually starts, not down to the
       recess floor. `.shell` clears the floor by another --sub-air and the
       Panel's own rule sits above that, so a row the depth of the recess
       centres too high — six pixels of air above it against fourteen below,
       which reads as pinned to the top edge rather than centred in the row. */
    height: calc(
      var(--sub-depth) + var(--sub-air) + var(--panel-line-w)
    );
    /* Sized to the corner rather than to its contents, so the row centres in
       the space the carve opens up instead of hugging the window's right
       edge. The width is what is left of the top row once the recess mouth
       and the Panel's own inset are taken off it. */
    width: calc(100% - var(--sub-mouth, 0px) - var(--pad-4));
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-3);
    min-width: 0;
  }
  /* Labels ellipsize rather than overrun the corner on a narrow window. */
  .top-acts :global(.btn) {
    min-width: 0;
  }

  /* The rule fills a full-width bar; a hugging pill has no edge to run to. */
  .subnav :global(.rule) {
    display: none;
  }
  /* Held for the two frames a section change takes to settle, so the indicator
     lands on the incoming section's tab instead of travelling to it. */
  .subnav.settling :global(.tabs::before) {
    transition: none;
  }

  /* Content clears the recess floor, less the padding the Panel already
     provides. Collapses to nothing when there is no bar. */
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    padding-top: max(
      0px,
      calc(var(--sub-depth) - var(--pad-3) + var(--sub-air))
    );
  }

  /* Wiped out until the GSAP reveal takes over (its inline clip-path wins).
     The tab indicator is anchored to a layout box, which exists from the first
     frame — so it has to be held back too, or it draws under a label that has
     not wiped in yet. */
  .navbar.unrevealed :global(button) {
    clip-path: inset(0 100% 0 0);
  }
  .navbar.unrevealed :global(.tabs::before) {
    opacity: 0;
  }

  .content {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  /* Hung in the Panel's own right padding instead of beside the content. The
     bar rides the window's edge, where a scrollbar belongs, and `main` gets
     the track's column back rather than paying for it twice. */
  .content > :global(.scrollbar) {
    margin-right: calc(-1 * var(--pad-3));
  }

  .dev-badge {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 9999;
    background: #f59e0b;
    color: #000;
    font: 700 0.85rem/1 var(--font-mono);
    padding: 0.35rem 0.7rem;
    letter-spacing: 0.1em;
    pointer-events: none;
    user-select: none;
  }

  /* Native bar hidden — the drawn scrollbar beside it takes over.
     The block padding is not cosmetic: a Panel's title and hint straddle its
     own rule at translateY(±50%), so half of each sits OUTSIDE the panel. A
     titled panel flush against this scroll box lost the top half of its label
     to `overflow: auto` — visible on admin, whose pages open straight onto
     one. Half a label's line box is the clearance that costs. */
  main {
    flex: 1;
    min-width: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    scrollbar-width: none;
    padding-right: var(--pad-2);
    padding-block: var(--main-air);
  }
  main::-webkit-scrollbar {
    display: none;
  }

  main > :global(*) {
    flex-shrink: 0;
  }
  main > :global(.chat) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Its own top spacing rather than a gap on .shell, so that when the row has
     nothing to print it takes up nothing at all. Almost every scope now marks
     its bindings hidden — Settings › keybinds is the discovery surface — so a
     permanently reserved row was a dead band above the window's lower edge on
     every view. */
  .hintrow {
    flex: none;
    min-height: 1.2rem;
    padding-top: var(--pad-2);
  }
  .hintrow:not(:has(*)) {
    min-height: 0;
    padding-top: 0;
  }
</style>
