<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import ChatView from "./chat/ChatView.svelte";
  import LibraryView from "./library/LibraryView.svelte";
  import WikiView from "./wiki/WikiView.svelte";
  import AdminView from "./admin/AdminView.svelte";
  import SettingsView from "./settings/SettingsView.svelte";
  import FeedbackView from "./reports/FeedbackView.svelte";
  import SetupWizard from "./access/SetupWizard.svelte";
  import LoginView from "./access/LoginView.svelte";
  import NotificationHost from "./notifications/NotificationHost.svelte";
  import { session, initSession } from "./access/session.svelte";
  import { navItems } from "./shell/nav";
  import { jellyPress, reflow } from "./motion/motion";
  import StarField from "./motion/StarField.svelte";
  import Wordmark from "./motion/Wordmark.svelte";
  import { loadThemeFromStorage, themeState } from "./theme/theme.svelte";
  import { loadFonts } from "./theme/fonts.svelte";
  import { loadDateFormat } from "./dates.svelte";
  import {
    router,
    openSection,
    section,
    startRouter,
  } from "./shell/router.svelte";
  import {
    refreshNotifications,
    startNotifications,
  } from "./notifications/notify.svelte";
  import { hints, pushScope, startKeys } from "./keys/keys.svelte";
  import { navKey, actionKey } from "./keys/bindings.svelte";
  import { loadVim, vimState, scrollBindings } from "./keys/vim.svelte";
  import { subnav, topActions } from "./shell/subnav.svelte";
  import { setScrollport } from "./shell/scrollport.svelte";
  import {
    CaretHost,
    HintRule,
    Icon,
    Panel,
    Scrollbar,
    Tabs,
    TipHost,
    tip,
  } from "./tui";

  const nav = $derived(navItems());

  const view = $derived(section("chat"));

  const sub = $derived(subnav());
  const acts = $derived(sub ? (topActions() ?? sub.actions) : undefined);

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

  let topbarEl = $state<HTMLElement>();
  let mainEl = $state<HTMLElement>();
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
   * The recess outline, as one path, from the window's left edge to `wall`. The
   * left end is the window's top-left corner moved down to the recess floor;
   * the right end rounds outward so the top rule sweeps into the recess. No CSS
   * border turns that way, so the outline is stroked from the path the mask is
   * filled from. `x0`/`y0` pull the open ends in onto the window's own rules.
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

  // Measured: the recess is cut to the bar's size, and the bar's box moves with
  // the text size and the interface font, so fixed rems would drift. The tokens
  // are resolved through the window for the same reason.
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
      // Nothing to redraw unless an input moved. Also guards against a
      // ResizeObserver loop, since this writes state the observed elements are
      // laid out from.
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
      // centred bar's own right edge plus its air - which is what happens on a
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
    const observer = new ResizeObserver(read);
    observer.observe(el);
    observer.observe(host);
    return () => observer.disconnect();
  });

  // The subnav bar outlives a section change (see `setSubnav`), so its
  // indicator would slide in from the old section's tab. Suppressed for two
  // frames: the recess observer re-centres the bar a frame after the switch.
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

  $effect(() => setScrollport(mainEl ?? null));

  // A pre effect, so the boxes are read while the bar is still where it was;
  // the tween starts once the DOM has caught up with the setting.
  $effect.pre(() => {
    void themeState.navHidden;
    const play = untrack(() => reflow([topbarEl, windowEl]));
    void tick().then(play);
  });

  // Hidden: four more entries would crowd the hint rule. Settings › keybinds
  // lists them.
  $effect(() => {
    const items = nav;
    return pushScope(
      items.map((n, i) => ({
        key: navKey(n.key, i),
        label: n.label,
        hidden: true,
        run: () => openSection(n.key),
      })),
    );
  });

  // Settings is not a tab, so navItems() assigns it no digit. It registers
  // its own hidden binding.
  $effect(() =>
    pushScope([
      {
        key: actionKey("settings"),
        label: "",
        hidden: true,
        inFields: true,
        run: () => openSection("settings"),
      },
      {
        key: actionKey("feedback"),
        label: "",
        hidden: true,
        inFields: true,
        run: () => {
          sessionStorage.setItem("tachy-feedback-from", router.path);
          openSection("feedback");
        },
      },
    ]),
  );

  // h/l walk the sections the digits jump to; ^d/^u page the main column.
  $effect(() => {
    if (!vimState.enabled) return;
    const items = nav;
    const at = items.findIndex((n) => n.key === view);
    const go = (delta: number) => () => {
      const next = items[Math.min(items.length - 1, Math.max(0, at + delta))];
      if (next && next.key !== view) openSection(next.key);
    };
    return pushScope([
      { key: "h", label: "", hidden: true, run: go(-1) },
      { key: "l", label: "", hidden: true, run: go(1) },
      ...scrollBindings(() => mainEl),
    ]);
  });

  $effect(() => {
    if (session.me) void refreshNotifications();
  });

  $effect(() => {
    if (session.me) void loadDateFormat();
  });

  onMount(() => {
    loadThemeFromStorage();
    loadFonts();
    loadVim();
    initSession();
    const stopRouter = startRouter();
    const stopKeys = startKeys();
    const stopNotify = startNotifications();
    return () => {
      stopRouter();
      stopKeys();
      stopNotify();
    };
  });
</script>

<StarField />

{#if session.config?.envBadge}
  <div class="dev-badge">{session.config.envBadge.toUpperCase()}</div>
{/if}

{#if session.loading}
  <!-- background only while the session resolves -->
{:else if showWizard}
  <SetupWizard onDone={() => {}} onSkip={skipWizard} />
{:else if showLogin}
  <LoginView />
{:else if view === "feedback"}
  <FeedbackView />
{:else}
  <div class="app" data-scene>
    <div
      class="topbar"
      class:hidden={themeState.navHidden}
      bind:this={topbarEl}
    >
      <div class="mark"><Wordmark /></div>
      <div class="navbar">
        <Panel>
          <Tabs
            items={nav}
            active={view}
            anchor="--tab-nav"
            labels={themeState.navLabels}
            onpick={openSection}
          />
        </Panel>
      </div>
      <!-- Empty: balances the wordmark's track so the pill sits on the true
           centre. -->
      <div class="mark"></div>
    </div>

    <!-- Out of flow, so nothing about it can shift the window: settings is
         not a place work happens, so it takes no slot in the bar. -->
    <button
      class="settings-btn"
      class:on={view === "settings"}
      aria-current={view === "settings" ? "page" : undefined}
      aria-label="settings"
      use:tip={"settings"}
      onclick={(e) => {
        openSection("settings");
        if (e.detail !== 0) e.currentTarget.blur();
      }}
      use:jellyPress
    >
      <span class="lbl"
        ><span class="br" aria-hidden="true">[</span><span class="ico"
          ><Icon name="settings" weight={7} /></span
        ><span class="br" aria-hidden="true">]</span></span
      >
    </button>

    <button
      class="settings-btn feedback-btn"
      class:on={view === "feedback"}
      aria-current={view === "feedback" ? "page" : undefined}
      aria-label="feedback"
      use:tip={"feedback"}
      onclick={(e) => {
        sessionStorage.setItem("tachy-feedback-from", router.path);
        openSection("feedback");
        if (e.detail !== 0) e.currentTarget.blur();
      }}
      use:jellyPress
    >
      <span class="lbl"
        ><span class="br" aria-hidden="true">[</span><span class="ico"
          ><Icon name="flag" weight={7} /></span
        ><span class="br" aria-hidden="true">]</span></span
      >
    </button>

    <div
      class="window"
      bind:this={windowEl}
      class:carved={sub}
      style="--sub-h-raw: {subH}px; --sub-mouth: {carveW}px; --sub-mask: {carveMask}"
    >
      <!-- Rendered before the window so its hotkey scope is pushed first and
           the view's scope stays innermost - otherwise this bar's (all hidden)
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
            labels={themeState.navLabels}
            onpick={sub.onpick}
          />
        </div>
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
              {:else if view === "wiki"}
                <WikiView />
              {:else if view === "console"}
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

    <NotificationHost />
  </div>
{/if}

<TipHost />
<CaretHost />

<style>
  /* Two objects on one centre line: the top row and the window under it. The
     bottom gutter is the widest, so the window floats; the gap is the
     narrowest, so the nav and the subnav read as one control. */
  /* The app blurs behind an open dialog: a filter on the scene, since under
     a backdrop blur Firefox leaves some pages sharp. No radius transition
     and no starfield: a blur is cheap only over still content. */
  :global(:root[data-dialog] [data-scene]) {
    filter: blur(var(--scrim-blur));
  }

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

  /* The cap is in px, not rem: max-width in rem multiplies by --font-scale,
     so a larger text size would widen the box. Characters per line track the
     text size; the frame around them does not. */
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

  /* The floating surfaces let the sky through faintly, so a star crossing
     behind stays perceptible. Panels nested inside keep --panel-bg opaque,
     so their inline titles mask the rule they straddle. */
  .window > :global(section),
  .navbar :global(> section) {
    background: var(--window-bg);
  }

  /* Chat has no window: the conversation sits on the sky, inside the bounds
     the other sections fill. The rule turns transparent rather than going
     away, so the box keeps its size. */
  .window:has(main > :global(.chat.bare)) > :global(section) {
    background: transparent;
    border-color: transparent;
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
  .topbar.hidden {
    display: none;
  }
  .mark {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  /* A lone tab, styled like one of Tabs.svelte's own, without the indicator
     that only makes sense among siblings. Pinned to the viewport's
     lower-left corner with its line box on the window's bottom edge. */
  .settings-btn {
    position: absolute;
    left: var(--pad-2);
    bottom: var(--pad-4);
    z-index: 2;
    display: inline-flex;
    align-items: baseline;
    gap: 0.1em;
    font: inherit;
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 0 var(--pad-1);
    line-height: 1;
    white-space: nowrap;
  }
  /* Sits one line above settings, sharing its lone-control styling. */
  .feedback-btn {
    bottom: calc(var(--pad-4) + var(--row-h));
  }
  .settings-btn:hover {
    color: var(--text);
  }
  .settings-btn.on {
    color: var(--accent);
  }
  .settings-btn:focus-visible {
    outline: none;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .settings-btn .br {
    visibility: hidden;
  }
  .settings-btn.on .br {
    visibility: visible;
  }
  .settings-btn .ico {
    display: inline-block;
    vertical-align: middle;
  }

  /* Hugs its content rather than the frame, so it reads as a separate object
     floating above the window instead of a bar attached to it. */
  .navbar {
    display: flex;
    justify-content: center;
  }
  /* The subnav's box, not a Panel's default: the two bars sit on one centre
     line, and a taller one over a shorter one reads as two objects. */
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

  /* The bar sits in a recess cut into the window's top edge. --sub-air is
     the space around it inside the recess, where the starfield shows because
     the fill is removed. Prefixed, since --drop is a global colour token. */
  .window {
    --sub-air: var(--pad-2);
    /* The air `main` keeps above and below its content. Named because a
       sticky child cannot rise above `main`'s content box, so it pins this
       far down and paints the strip left over it. See .bar in LibraryView. */
    --main-air: calc(var(--fs-xs) * 0.9);
    /* Right edge to recess wall: the corner the carved row keeps for its own
       content. The recess takes everything else, out to the left edge. Sized
       for the widest row it carries, cancel and save in capitals. */
    --sub-reserve: 17rem;
    --sub-depth: calc(var(--sub-h-raw, 0px) + var(--sub-air));
  }

  /* mask, not clip-path: clip-path would take the window's rounded corners
     off with it, since the polygon has to be square. Subtracting a shape
     leaves every other edge untouched. */
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

  /* The mask removes the fill and the rule along the cut, so the recess is
     drawn back in here. Stroked, not bordered: the mouth flares outward, and
     no CSS border turns that way. */
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

  /* No box of its own: the recess is the box, and the window's edge does the
     framing. Centred on the window's centre line, the one the nav pill sits
     on, so the two stack. */
  .subnav {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    /* No block padding: --sub-air already clears the labels off the recess
       floor. The floor is the least the corner needs to fit a full-height
       control, and what a section with no tabs is cut to. */
    box-sizing: border-box;
    display: flex;
    align-items: center;
    min-height: var(--row-h);
    padding: 0 var(--pad-3);
  }

  /* The window's own top row, right of the recess. Aligned to the Panel's
     content edge so it reads as part of the page, and capped short of the
     recess mouth. */
  .top-acts {
    position: absolute;
    top: 0;
    right: var(--pad-4);
    z-index: 2;
    /* The band down to where page content starts, not to the recess floor:
       `.shell` clears the floor by another --sub-air and the Panel's rule
       sits over that, so a row the depth of the recess centres too high. */
    height: calc(var(--sub-depth) + var(--sub-air) + var(--panel-line-w));
    /* Sized to the corner, not to its contents, so the row centres in the
       space the carve opens. The width is the top row less the recess mouth
       and the Panel's inset. */
    width: calc(100% - var(--sub-mouth, 0px) - var(--pad-4));
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-3);
    min-width: 0;
  }
  /* Labels ellipsize rather than overrun the corner on a narrow window.
     Capitals because lowercase words up here read as a caption, not as
     something to press. */
  .top-acts :global(.btn) {
    min-width: 0;
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
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

  /* Native bar hidden: the drawn scrollbar beside it takes over. The block
     padding is clearance: a Panel's title and hint straddle its rule, so
     half of each sits outside the panel and `overflow: auto` would clip it. */
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

  :global(.panel.grow:has(.bleed)) {
    padding-inline: 0;
    padding-bottom: 0;
  }
  main:has(:global(.bleed)) {
    overflow: hidden;
    padding: 0;
  }
  .content:has(:global(.bleed)) > :global(.scrollbar) {
    display: none;
  }

  main > :global(*) {
    flex-shrink: 0;
  }
  main > :global(.chat) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Its own top spacing, not a gap on .shell, so a row with nothing to print
     takes no room. Most scopes mark their bindings hidden, and Settings ›
     keybinds is where they are found. */
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
