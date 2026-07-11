<script lang="ts">
  import { session } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import TeamsPanel from "./TeamsPanel.svelte";
  import ProductsPanel from "./ProductsPanel.svelte";
  import SourcesPanel from "./SourcesPanel.svelte";
  import ComponentsPanel from "./ComponentsPanel.svelte";
  import LabelsPanel from "./LabelsPanel.svelte";
  import PatternsPanel from "./PatternsPanel.svelte";
  import CustomersPanel from "./CustomersPanel.svelte";
  import UsersPanel from "./UsersPanel.svelte";
  import MembershipPanel from "./MembershipPanel.svelte";
  import SystemPanel from "./SystemPanel.svelte";
  import CredentialsPanel from "./CredentialsPanel.svelte";

  type Section =
    | "teams" | "products" | "sources"
    | "components" | "labels" | "patterns" | "customers"
    | "users" | "membership"
    | "system" | "credentials";

  const isGlobalAdmin = $derived(session.me?.role === "admin" || !session.me);

  type Group = { key: string; label: string; sections: { key: Section; label: string }[] };

  const groups: Group[] = $derived.by(() => {
    const org: Group = {
      key: "org", label: "Org",
      sections: [
        { key: "teams", label: t("teams") },
        { key: "products", label: t("products") },
        ...(isGlobalAdmin ? [{ key: "sources" as Section, label: "sources" }] : []),
      ],
    };
    const taxonomy: Group = {
      key: "taxonomy", label: "Taxonomy",
      sections: [
        { key: "components", label: "components" },
        { key: "labels", label: "labels" },
        { key: "patterns", label: "patterns" },
        ...(showCustomer() ? [{ key: "customers" as Section, label: t("customers") }] : []),
      ],
    };
    const people: Group = {
      key: "people", label: "People",
      sections: [
        ...(isGlobalAdmin ? [{ key: "users" as Section, label: "users" }] : []),
        { key: "membership", label: "membership" },
      ],
    };
    const system: Group = {
      key: "system", label: "System",
      sections: [
        ...(isGlobalAdmin ? [{ key: "system" as Section, label: "settings" }] : []),
        { key: "credentials", label: "credentials" },
      ],
    };
    return [org, taxonomy, people, system];
  });

  let active = $state<Section>("teams");
</script>

<div class="admin-root">
  <!-- Group nav as an ASCII tree: parents are non-clickable roots spread evenly
       across the top, their sections hang centered below, connected by box-
       drawing stems. Every section is reachable in one click. -->
  <nav class="tree" aria-label="admin sections">
    {#each groups as g (g.key)}
      <div class="grp">
        <div class="grp-label">{g.label}</div>
        <div class="stem" aria-hidden="true">│</div>
        <div class="kids" class:single={g.sections.length === 1}>
          {#each g.sections as s (s.key)}
            <button class="kid" class:active={active === s.key} onclick={() => (active = s.key)}>{s.label}</button>
          {/each}
        </div>
      </div>
    {/each}
  </nav>

  {#if active === "teams"}<TeamsPanel />
  {:else if active === "products"}<ProductsPanel />
  {:else if active === "sources"}<SourcesPanel />
  {:else if active === "components"}<ComponentsPanel />
  {:else if active === "labels"}<LabelsPanel />
  {:else if active === "patterns"}<PatternsPanel />
  {:else if active === "customers"}<CustomersPanel />
  {:else if active === "users"}<UsersPanel />
  {:else if active === "membership"}<MembershipPanel />
  {:else if active === "system"}<SystemPanel />
  {:else if active === "credentials"}<CredentialsPanel />
  {/if}
</div>

<style>
  /* ASCII tree nav: four evenly-spread group columns, each a root label with a
     centered stem branching down to its clickable sections. */
  .tree {
    display: flex; align-items: flex-start; justify-content: space-around;
    gap: 1rem; flex-wrap: wrap; margin: 0.25rem 0 1.1rem;
  }
  .grp { flex: 1 1 8rem; min-width: 7rem; display: flex; flex-direction: column; align-items: center; }
  .grp-label {
    font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--muted); padding: 0.22rem 0.75rem;
    white-space: nowrap;
  }
  /* Box-drawing stem from the root down to the sections' shelf. */
  .stem {
    font-family: ui-monospace, monospace; line-height: 1; color: var(--muted);
    height: 1.1em; user-select: none;
  }
  .kids {
    position: relative; width: 100%;
    display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center;
    padding-top: 0.75rem; border-top: 1px solid var(--border);
  }
  /* The ┴ junction where the stem meets the shelf; backed by the page bg so the
     shelf line reads as passing behind it. */
  .kids::before {
    content: "┴"; position: absolute; top: -0.62em; left: 50%; transform: translateX(-50%);
    font-family: ui-monospace, monospace; line-height: 1; color: var(--muted);
    background: var(--bg); padding: 0 0.15rem;
  }
  /* A lone section needs no shelf — the stem runs straight into it. */
  .kids.single { border-top: none; padding-top: 0.35rem; }
  .kids.single::before { content: none; }
  .kid { font-size: 0.8rem; padding: 0.2rem 0.6rem; white-space: nowrap; }
  .kid.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

  /* Shared look for all panels, so each one stays lean. */
  .admin-root :global(table) { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-bottom: 0.75rem; }
  .admin-root :global(th), .admin-root :global(td) {
    text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top;
  }
  .admin-root :global(th) { color: var(--muted); font-weight: 500; }
  .admin-root :global(.tip) { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
  .admin-root :global(.mini) { font-size: 0.75rem; padding: 0.15rem 0.5rem; }
  .admin-root :global(.danger-btn) { border-color: var(--danger); color: var(--danger); }
  /* Square glyph buttons for row actions (edit ✎ / delete ✕). Fixed size so the
     row never reflows — the delete confirm arms by filling the square red rather
     than swapping in longer "confirm?" text. */
  .admin-root :global(.icon-btn) {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.7rem; height: 1.7rem; padding: 0;
    font-size: 0.95rem; line-height: 1;
    border: 1px solid var(--border); background: transparent; color: var(--muted);
  }
  .admin-root :global(.icon-btn + .icon-btn) { margin-left: 0.3rem; }
  .admin-root :global(.icon-btn:hover) { color: var(--text); border-color: var(--text); }
  .admin-root :global(.icon-btn.danger) { color: var(--danger); border-color: var(--danger); }
  .admin-root :global(.icon-btn.danger:hover) { background: color-mix(in srgb, var(--danger) 15%, transparent); }
  /* Save (✓) reads as the positive/apply action; cancel (↺) stays neutral so it
     never reads like the destructive delete ✕. */
  .admin-root :global(.icon-btn.ok) { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
  .admin-root :global(.icon-btn.ok:hover:not(:disabled)) { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
  .admin-root :global(.icon-btn:disabled) { opacity: 0.4; }
  /* Armed: solid red fill, glyph flips to the page bg so the ✕ stays readable. */
  .admin-root :global(.icon-btn.danger.armed) {
    background: var(--danger); border-color: var(--danger); color: var(--bg);
  }
  .admin-root :global(h4) { margin: 0.75rem 0 0.4rem; font-size: 0.85rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .admin-root :global(.add-area) { margin-top: 0.5rem; }
  .admin-root :global(.add-form) { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .admin-root :global(.add-form label) { display: flex; gap: 0.4rem; align-items: center; color: var(--muted); font-size: 0.85rem; }
  .admin-root :global(.add-form input) { min-width: 9rem; }
  .admin-root :global(.scope) { display: flex; align-items: baseline; gap: 0.9rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .admin-root :global(.scope label) { display: flex; gap: 0.5rem; align-items: baseline; color: var(--muted); font-size: 0.85rem; }
  .admin-root :global(.hint) { font-size: 0.8rem; }
  .admin-root :global(.muted) { color: var(--muted); }
  .admin-root :global(.error) { color: var(--danger); }
  .admin-root :global(.row-edit) { display: flex; gap: 0.35rem; flex-wrap: wrap; align-items: center; }
  .admin-root :global(.row-edit input) { min-width: 8rem; font-size: 0.85rem; }
  /* Inline edit field grows with its content (up to a hard cap) so entering edit
     mode doesn't reflow the row; save/cancel are icon buttons in the actions
     cell, matching ✎/✕, so that column keeps its width too. */
  .admin-root :global(.row-input) {
    field-sizing: content;
    width: auto; min-width: 5ch; max-width: 22rem;
    font-size: 0.85rem;
  }
  .admin-root :global(td.actions) { white-space: nowrap; }
</style>
