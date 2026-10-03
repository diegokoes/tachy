<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { api } from "../api";
  import { gsap, reducedMotion } from "../motion/gsap";
  import { toast } from "../notifications/notify.svelte";
  import { createResource, errText } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import { canCurateScope } from "../access/session.svelte";
  import { slugify, uniqueSlug } from "../slug";
  import { Button, Icon, Note, Scrollbar, Select, tip } from "../tui";
  import Orbit from "./Orbit.svelte";
  import type { Repo } from "./rows";
  import type { SourceProject } from "../sources/rows";

  type FoundRepo = { name: string; url: string; default_branch: string };

  const HEADING = "PROJECT";

  /** Past this many letters the burst is flown per name, not per letter. */
  const MAX_LETTERS = 900;

  const repos = createResource(
    () => api.get<{ repos: Repo[] }>("/repos").then((r) => r.repos),
    [],
  );
  const projects = createResource(
    () => api.get<SourceProject[]>("/source-projects"),
    [],
  );

  const mine = $derived(
    projects.data
      .filter((p) => p.product_id && canCurateScope({ team_slug: p.team_slug }))
      .sort((a, b) => a.external_key.localeCompare(b.external_key)),
  );
  const options = $derived(
    mine.map((p) => ({
      value: p.id,
      label: p.external_key,
      hint: `${p.source_slug} · ${p.product_slug}`,
    })),
  );

  const linked = $derived(new Set(repos.data.map((r) => r.url)));

  let chosen = $state("");
  let project = $state<SourceProject | null>(null);
  let seeking = $state(false);
  /** A later project being asked, once the orbit is gone. */
  let fetching = $state(false);
  /** The first answer is in: the hole has closed and only the names are left. */
  let landed = $state(false);
  let failure = $state<string | null>(null);
  let list = $state<FoundRepo[]>([]);
  let picked = $state(new Set<string>());
  let filter = $state("");
  let linking = $state(false);
  let rejected = $state<{ slug: string; error?: string }[]>([]);

  const found: Record<string, FoundRepo[]> = {};

  let orbit = $state<ReturnType<typeof Orbit>>();
  let stage = $state<HTMLElement>();
  let scroller = $state<HTMLElement>();
  let cloud = $state<HTMLElement>();
  let dock = $state<HTMLElement>();
  let search = $state<HTMLInputElement>();

  let viewH = $state(0);
  let topH = $state(0);
  let orbH = $state(0);
  /** Never less than the button row needs, which hangs in this gap. */
  const orbGap = $derived(Math.max(56, (viewH - orbH) / 2 - topH));

  const mode = $derived(seeking ? "seek" : landed ? "gone" : "idle");

  const q = $derived(filter.trim().toLowerCase());
  const matches = (r: FoundRepo) => !q || r.name.toLowerCase().includes(q);
  const open = $derived(list.filter((r) => !linked.has(r.url)));
  const openShown = $derived(open.filter(matches));
  const pickedCount = $derived(list.filter((r) => picked.has(r.url)).length);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const byName = (a: FoundRepo, b: FoundRepo) =>
    a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });

  async function discover(p: SourceProject) {
    const res = await api.get<{
      ok: boolean;
      error?: string;
      repos?: FoundRepo[];
    }>(
      `/source-connections/${p.source_slug}/discover/repos?project=${encodeURIComponent(p.external_key)}`,
    );
    if (!res.ok) throw new Error(res.error ?? "discovery failed");
    found[p.id] = [...(res.repos ?? [])].sort(byName);
  }

  async function choose(id: string) {
    const p = mine.find((m) => m.id === id);
    if (!p || p.id === project?.id || seeking || fetching) return;
    project = p;
    failure = null;
    rejected = [];
    filter = "";
    picked = new Set();
    if (landed) return swap(p);
    seeking = true;
    try {
      await Promise.all([
        found[p.id] ? null : discover(p),
        wait(reducedMotion() ? 0 : (orbit?.holdFor() ?? 0)),
      ]);
      list = found[p.id] ?? [];
      landed = true;
      seeking = false;
      await tick();
      explode();
    } catch (e) {
      seeking = false;
      failure = errText(e);
    }
  }

  /**
   * Every project after the first: no orbit left to play. The old names lift
   * out at once while the source is asked, and the new ones settle in as soon
   * as it answers: one fade each way.
   */
  async function swap(p: SourceProject) {
    fetching = true;
    const out = Promise.all([rewind(), fadeOut()]);
    let next: FoundRepo[] = [];
    try {
      if (!found[p.id]) await discover(p);
      next = found[p.id] ?? [];
    } catch (e) {
      failure = errText(e);
    }
    const had = list.length > 0;
    await out;
    list = next;
    fetching = false;
    await tick();
    fadeIn();
    if (!had) reveal();
  }

  const tagsIn = () =>
    cloud ? [...cloud.querySelectorAll<HTMLElement>(".tag")] : [];

  async function fadeOut() {
    const tags = tagsIn();
    if (!tags.length || reducedMotion()) return;
    await gsap.to(tags, {
      opacity: 0,
      y: -8,
      duration: 0.25,
      ease: "power2.in",
      stagger: { each: Math.min(0.006, 0.12 / tags.length) },
    });
  }

  function fadeIn() {
    const tags = tagsIn();
    if (!tags.length || reducedMotion()) return;
    gsap.fromTo(
      tags,
      { opacity: 0, y: 10 },
      {
        opacity: 1,
        y: 0,
        duration: 0.35,
        ease: "power2.out",
        stagger: { each: Math.min(0.012, 0.3 / tags.length) },
        clearProps: "opacity,transform",
      },
    );
  }

  function toggle(r: FoundRepo) {
    if (linked.has(r.url) || linking) return;
    const next = new Set(picked);
    if (next.has(r.url)) next.delete(r.url);
    else next.add(r.url);
    picked = next;
  }

  /** Acts on what the filter leaves lit, so "…-api" then "all" is two actions. */
  function pickShown(on: boolean) {
    const next = new Set(picked);
    for (const r of openShown) {
      if (on) next.add(r.url);
      else next.delete(r.url);
    }
    picked = next;
  }

  async function link() {
    if (!project) return;
    const hits = list.filter((r) => picked.has(r.url) && !linked.has(r.url));
    if (!hits.length) return;
    linking = true;
    failure = null;
    try {
      const taken = repos.data.map((r) => r.slug);
      const payload = hits.map((r) => {
        const slug = uniqueSlug(slugify(r.name), taken);
        taken.push(slug);
        return { slug, url: r.url, branch: r.default_branch || "main" };
      });
      const res = await api.put<{
        ok: boolean;
        results: { slug: string; ok: boolean; error?: string }[];
      }>("/repos/bulk", { source_project_id: project.id, repos: payload });
      await repos.reload();
      rejected = res.results.filter((r) => !r.ok);
      const bad = new Set(rejected.map((r) => r.slug));
      picked = new Set(
        payload.filter((p) => bad.has(p.slug)).map((p) => p.url),
      );
      const n = res.results.length - rejected.length;
      if (n)
        toast(
          `linked ${n} repo${n === 1 ? "" : "s"} from ${project.external_key}`,
        );
    } catch (e) {
      failure = errText(e);
    } finally {
      linking = false;
    }
  }

  let flight: gsap.core.Timeline | null = null;

  /**
   * The names are already laid out where they belong; every letter starts in
   * the orbit's core, is flung out around it, then falls into its slot. Only
   * transforms move, so the page never reflows under the reader and the
   * scrollbar that the cloud brings along appears once, without a jump.
   */
  function explode() {
    flight?.kill();
    const from = orbit?.centre();
    if (!cloud || !from || reducedMotion()) return reveal();
    const tags = [...cloud.querySelectorAll<HTMLElement>(".tag")];
    if (!tags.length) return reveal();
    const letters = [...cloud.querySelectorAll<HTMLElement>(".tag .ch")];
    const movers =
      letters.length <= MAX_LETTERS
        ? letters
        : [...cloud.querySelectorAll<HTMLElement>(".tag .name")];
    const frames = [...cloud.querySelectorAll<HTMLElement>(".frame")];
    gsap.set([search, dock].filter(Boolean), { opacity: 0 });
    gsap.set(frames, { opacity: 0 });

    const n = movers.length;
    const home = movers.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: from.x - (r.left + r.width / 2),
        y: from.y - (r.top + r.height / 2),
      };
    });
    const reach = Math.min(150, 50 + 5 * Math.sqrt(n));
    const fling = movers.map((_, i) => {
      const a = i * 2.39996 + Math.random() * 0.6;
      const r = reach * (0.45 + 0.55 * Math.random());
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });

    const tl = gsap.timeline({ onComplete: () => (flight = null) });
    tl.fromTo(
      movers,
      {
        x: (i) => home[i].x,
        y: (i) => home[i].y,
        scale: 0.1,
        rotation: () => gsap.utils.random(-160, 160),
        opacity: 0,
      },
      {
        x: (i) => home[i].x + fling[i].x,
        y: (i) => home[i].y + fling[i].y,
        scale: 0.75,
        opacity: 1,
        duration: 0.42,
        ease: "power3.out",
        stagger: { each: Math.min(0.004, 0.22 / n) },
      },
      0,
    ).to(
      movers,
      {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        duration: 0.6,
        ease: "power4.inOut",
        stagger: { each: Math.min(0.006, 0.3 / n) },
      },
      "-=0.1",
    );
    tl.fromTo(
      frames,
      { opacity: 0, scaleX: 0.7 },
      {
        opacity: 1,
        scaleX: 1,
        duration: 0.25,
        ease: "back.out(1.6)",
        stagger: { each: Math.min(0.01, 0.2 / frames.length) },
      },
      "-=0.05",
    );
    tl.set([...movers, ...frames], { clearProps: "all" });
    tl.add(reveal, "-=0.3");
    flight = tl;
  }

  /** The controls for the answer arrive once the answer has landed. */
  function reveal() {
    if (reducedMotion()) return;
    const parts = [search, dock].filter(Boolean);
    if (!parts.length) return;
    gsap.fromTo(
      parts,
      { opacity: 0, y: (i) => (parts[i] === dock ? 12 : -6) },
      {
        opacity: 1,
        y: 0,
        duration: 0.35,
        ease: "power2.out",
        stagger: 0.06,
        clearProps: "transform",
      },
    );
  }

  /** Back to the top, so a shorter list never lands with the view clamped under it. */
  async function rewind() {
    const top = scroller?.scrollTop ?? 0;
    if (!scroller || !top) return;
    if (reducedMotion()) {
      scroller.scrollTop = 0;
      return;
    }
    await gsap.to(scroller, {
      scrollTo: { y: 0 },
      duration: Math.min(0.9, 0.35 + top / 2500),
      ease: "power2.inOut",
    });
  }

  function leave() {
    flight?.kill();
    navigate("/admin/integrations/repos");
  }

  onMount(() => {
    void repos.reload();
    void projects.reload();
    if (!stage || reducedMotion()) return;
    gsap.fromTo(
      stage.querySelectorAll(".heading .ch"),
      { opacity: 0, y: "0.6em" },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: "power3.out",
        stagger: 0.05,
        delay: 0.25,
        clearProps: "all",
      },
    );
    gsap.fromTo(
      stage.querySelectorAll(".pick, .close"),
      { opacity: 0 },
      { opacity: 1, duration: 0.5, delay: 0.55, clearProps: "opacity" },
    );
  });

  onDestroy(() => flight?.kill());
</script>

<div class="stage" bind:this={stage}>
  <button
    class="close"
    onclick={leave}
    aria-label="back to repos"
    use:tip={"back to repos"}
  >
    <Icon name="close" size="1.4em" weight={6} />
  </button>

  <div class="scroller" bind:this={scroller} bind:clientHeight={viewH}>
    <div class="inner">
      <div class="top" bind:clientHeight={topH}>
        <h1 class="heading rise" aria-label={HEADING}>
          {#each [...HEADING] as ch, i (i)}<span class="ch" aria-hidden="true"
              >{ch}</span
            >{/each}
        </h1>

        <div class="pick rise">
          <Select
            bind:value={chosen}
            {options}
            searchable
            placement="beside"
            placeholder={projects.loading
              ? "loading…"
              : mine.length
                ? "choose a project"
                : "no project you can link into"}
            disabled={seeking || fetching || linking || !mine.length}
            aria-label="project to link repos from"
            onchange={(v) => choose(String(v))}
          />
        </div>

        <div class="find rise">
          {#if list.length}
            <input
              bind:this={search}
              placeholder="filter repos…"
              aria-label="filter repos"
              bind:value={filter}
              disabled={linking}
            />
          {/if}
        </div>
      </div>

      <!-- The orbit's place, centred on the window: the controls above take
           what they need and it sits where the eye lands. Once the hole
           closes, the names take the same place, a short list centred where
           it was and a long one running on down from there. -->
      <div
        class="well"
        style:margin-top="{orbGap}px"
        style:min-height="{orbH}px"
      >
        <div class="orb" bind:clientHeight={orbH}>
          <Orbit bind:this={orbit} {mode} />
        </div>

        {#if landed && failure}
          <p class="quiet danger" aria-live="polite">{failure}</p>
        {:else if landed && project && !list.length && !fetching}
          <p class="quiet">
            {project.external_key} shows no repos to this token
          </p>
        {/if}

        <div class="answer">
          <!-- Hung above the names rather than stacked in the column: it sits
               by what it acts on, and taking a row of its own would push them
               down from where the hole was. -->
          {#if list.length && open.length}
            <div class="dock" bind:this={dock}>
              <Button
                variant="ghost"
                size="sm"
                disabled={linking || !openShown.length}
                onclick={() => pickShown(true)}>ALL</Button
              >
              <Button
                variant="ghost"
                size="sm"
                disabled={linking || !pickedCount}
                onclick={() => pickShown(false)}>NONE</Button
              >
              <span class="gap"></span>
              <Button
                variant="ghost"
                tone="ok"
                size="sm"
                icon="create"
                busy={linking}
                disabled={!pickedCount}
                onclick={link}>LINK {pickedCount}</Button
              >
            </div>
          {/if}

          <div class="cloud" bind:this={cloud}>
            {#each list as r (r.url)}
              {@const taken = linked.has(r.url)}
              <button
                type="button"
                class="tag"
                class:on={picked.has(r.url)}
                class:away={!matches(r)}
                disabled={taken}
                aria-pressed={taken || picked.has(r.url)}
                use:tip={taken ? `${r.name} · already linked` : r.url}
                onclick={() => toggle(r)}
              >
                <span class="frame" aria-hidden="true"></span>
                <span class="name"
                  >{#each [...r.name] as ch, i (i)}<span class="ch">{ch}</span
                    >{/each}</span
                >
              </button>
            {/each}
          </div>

          {#if rejected.length}
            <div class="rejected">
              <Note tone="warn">
                {rejected.length} could not be linked:
                {rejected.map((r) => `${r.slug} (${r.error})`).join("; ")}
              </Note>
            </div>
          {/if}
        </div>
      </div>

      {#if failure && !landed}
        <p class="quiet danger" aria-live="polite">{failure}</p>
      {/if}
    </div>
  </div>
  <div class="rail"><Scrollbar target={scroller} /></div>
</div>

<style>
  .stage {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    display: flex;
  }

  .close {
    position: absolute;
    top: var(--pad-3);
    right: var(--pad-4);
    z-index: 2;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: var(--pad-2);
    line-height: 0;
  }
  .close:hover,
  .close:focus-visible {
    color: var(--text);
  }

  /* Laid over the edge rather than beside it: the bar only exists once the
     cloud overflows, and in flow its arrival would pull the column sideways. */
  .rail {
    position: absolute;
    top: var(--pad-2);
    bottom: var(--pad-2);
    right: var(--pad-1);
    display: flex;
    pointer-events: none;
  }
  .rail > :global(*) {
    pointer-events: auto;
  }

  .scroller {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    scrollbar-width: none;
    overscroll-behavior: contain;
  }
  .scroller::-webkit-scrollbar {
    display: none;
  }

  /* Never centred as a column: the cloud grows the page downward when it
     lands, and a centred column would jump up to make room for it. */
  .inner {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 var(--view-pad-x);
  }
  .top {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    padding-top: clamp(1.25rem, 6vh, 3.5rem);
  }

  .heading {
    margin: 0 0 var(--pad-4);
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    line-height: 1;
    letter-spacing: 0.14em;
    font-weight: 700;
    color: var(--text);
  }
  .ch {
    display: inline-block;
    white-space: pre;
  }

  .pick {
    width: min(20rem, 100%);
  }
  .pick :global(.asel) {
    width: 100%;
  }

  /* Held open before there is anything to filter, so the field arriving
     never moves the orbit. */
  .find {
    width: min(20rem, 100%);
    height: var(--control-h);
    margin-top: var(--pad-2);
  }
  .find input {
    width: 100%;
  }

  .well {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  /* Out of flow, so the names can take its place without the hole's box
     pushing them down. */
  .orb {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    line-height: 0;
    pointer-events: none;
  }

  .quiet {
    margin: var(--pad-4) 0 0;
    font-size: var(--fs-sm);
    color: var(--muted);
    text-align: center;
  }
  .well .quiet {
    margin: 0;
  }
  .danger {
    color: var(--danger);
  }
  .rejected {
    width: min(40rem, 100%);
    margin-top: var(--pad-2);
  }

  .cloud {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-content: flex-start;
    gap: var(--pad-2);
    width: min(64rem, 100%);
    padding-bottom: var(--pad-4);
  }

  .answer {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }
  /* As wide as the fields above, so its ends line up with theirs. */
  .dock {
    position: absolute;
    bottom: calc(100% + var(--pad-2));
    left: 0;
    right: 0;
    width: min(20rem, 100%);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: var(--pad-1);
  }
  .dock .gap {
    flex: 1;
  }

  .tag {
    position: relative;
    padding: var(--pad-1) var(--pad-3);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    line-height: 1.5;
    white-space: pre;
    cursor: pointer;
    /* The filter box dims through `filter`, never `opacity`: opacity belongs
       to the tweens that bring tags in and out, and a transition on it
       trailed every frame of theirs. */
    transition: filter 0.2s ease;
  }
  .frame {
    position: absolute;
    inset: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-chip);
    background: var(--accent-dim);
    transition:
      border-color 0.15s ease,
      background 0.3s ease;
  }
  .name {
    position: relative;
    display: inline-block;
  }
  .tag:hover:not(:disabled) .frame,
  .tag:focus-visible .frame {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .tag.on {
    color: var(--accent);
  }
  .tag.on .frame {
    border-color: var(--accent);
  }
  .tag:disabled {
    cursor: default;
  }
  .tag:disabled:not(.on) {
    color: var(--muted);
  }
  .tag:disabled:not(.on) .frame {
    background: none;
    border-color: var(--border);
  }
  .tag.away {
    filter: opacity(0.25);
    pointer-events: none;
  }
</style>
