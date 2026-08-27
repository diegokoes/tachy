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
  import { subnav } from "./lib/subnav.svelte";
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
  let subW = $state(0);
  let subH = $state(0);
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
   * Walls are vertical: the mouth and the floor sit at the same x, so the two
   * corner pairs line up and the rounding on each reads as belonging to the
   * same shape. Its width comes from the window, not the bar — it opens out to
   * within `--sub-reserve` of each edge, leaving a corner for the row's own
   * content, and only falls back to hugging the bar when the window is too
   * narrow for that.
   *
   * The floor rounds inward like any box corner; the mouth rounds outward, so
   * the window's top rule sweeps down into the recess instead of stopping at a
   * square shoulder. A CSS border cannot turn that way, which is why the
   * outline is stroked from the same path the mask is filled from — generating
   * them separately is how a cut and the line drawn on it drift apart.
   *
   * `y0` lifts the open ends: the stroke is centred on the path, so starting it
   * half a line-width down lands it exactly on the window's own top rule.
   */
  function recessPath(half: number, h: number, round: number, y0: number) {
    const W = 2 * (half + round);
    const l = round;
    const r = W - round;
    // Two decimals: sub-pixel is plenty, and the raw floats triple the length
    // of the data URI this ends up inside.
    const n = (v: number) => Math.round(v * 100) / 100;
    return [
      `M0 ${n(y0)}`,
      `Q${n(l)} ${n(y0)} ${n(l)} ${n(y0 + round)}`,
      `L${n(l)} ${n(h - round)}`,
      `Q${n(l)} ${n(h)} ${n(l + round)} ${n(h)}`,
      `L${n(r - round)} ${n(h)}`,
      `Q${n(r)} ${n(h)} ${n(r)} ${n(h - round)}`,
      `L${n(r)} ${n(y0 + round)}`,
      `Q${n(r)} ${n(y0)} ${n(W)} ${n(y0)}`,
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
      subW = 0;
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

      subW = w;
      subH = h0;

      const air = cssPx(host, "var(--sub-air)");
      const line = cssPx(host, "var(--panel-line-w)");
      const reserve = cssPx(host, "var(--sub-reserve)");
      // The bar's own radius, so the two read as the same family of corner.
      const round = cssPx(host, "var(--radius)");

      // Open to within `reserve` of each edge, but never tighter than the air
      // the bar needs — which is what happens on a window too narrow for both.
      const half = Math.max(w / 2 + air, avail / 2 - reserve);
      const h = h0 + air;
      carveW = 2 * (half + round);
      carveH = h + line;

      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${carveW}" height="${h}">` +
        `<path d="${recessPath(half, h, round, 0)} Z" fill="black"/></svg>`;
      carveMask = `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
      carveOutline = recessPath(half, h, round, line / 2);
    };

    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    ro.observe(host);
    return () => ro.disconnect();
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
          <Tabs items={nav} active={view} onpick={(k) => navigate(`/${k}`)} />
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
        <div class="subnav" bind:this={subEl}>
          <Panel>
            <Tabs
              items={sub.items}
              active={sub.active}
              hotkeys="shift"
              onpick={sub.onpick}
            />
          </Panel>
        </div>
        {#if sub.actions}
          <div class="top-acts">{@render sub.actions()}</div>
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
     object rather than as content jammed into the viewport. */
  .app {
    position: relative;
    z-index: 1;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-3);
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
  .navbar :global(> section) {
    width: max-content;
    max-width: 100%;
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
    --sub-air: var(--pad-3);
    /* Window edge to recess wall: the corner the carved row keeps for its own
       content. The recess takes everything else. */
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
      top center,
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
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    overflow: visible;
    pointer-events: none;
  }
  .notch path {
    fill: none;
    stroke: var(--muted);
    stroke-width: var(--panel-line-w);
  }

  /* Flush with the window's top edge, so the bar's own top rule lands where
     the window's would have run. */
  .subnav {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
  }
  /* The window's own top row, either side of the recess — space the carve
     opens up and nothing else was using. Aligned to the Panel's content edge
     so it reads as part of the page, and capped short of the recess mouth so
     it can never collide with it. */
  .top-acts {
    position: absolute;
    top: 0;
    right: var(--pad-4);
    z-index: 2;
    height: var(--sub-depth);
    max-width: calc(50% - var(--sub-mouth, 0px) / 2 - var(--pad-4));
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap);
    min-width: 0;
  }

  /* The rule fills a full-width bar; a hugging pill has no edge to run to. */
  .subnav :global(.rule) {
    display: none;
  }
  .subnav :global(> section) {
    width: max-content;
    padding: var(--pad-2) var(--pad-3);
  }

  /* Content clears the recess floor, less the padding the Panel already
     provides. Collapses to nothing when there is no bar. */
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    gap: var(--pad-2);
    padding-top: max(
      0px,
      calc(var(--sub-depth) - var(--pad-3) + var(--sub-air))
    );
  }

  /* Wiped out until the GSAP reveal takes over (its inline clip-path wins). */
  .navbar.unrevealed :global(button) {
    clip-path: inset(0 100% 0 0);
  }

  .content {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
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
    padding-block: calc(var(--fs-xs) * 0.9);
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

  .hintrow {
    flex: none;
    min-height: 1.2rem;
  }
</style>
