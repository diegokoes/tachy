<script lang="ts">
  // Admin shell: group nav (Org | Taxonomy | People | System) + section subtabs.
  // Each panel is self-contained (own data + state); the shell only decides
  // which sections the caller may see and hosts the shared table styling.
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

  type Section =
    | "teams" | "products" | "sources"
    | "components" | "labels" | "patterns" | "customers"
    | "users" | "membership"
    | "system";

  const isGlobalAdmin = $derived(session.me?.role === "admin" || !session.me);

  const EXPLAINERS: Record<Section, string> = $derived({
    teams: `Top of the hierarchy. A ${t("team")} owns one or more ${t("products")} - one ${t("team")} covering several is the normal case.`,
    products: `What the knowledge is about. Everything else hangs off a ${t("product")}: its components, labels, knowledge entries, and source mappings.`,
    sources: "Where tickets/issues come from. One connection per system (a Freshdesk domain, a GitHub repo…); the group→product map routes each connection's groups/repos onto your catalog.",
    components: `Per-${t("product")} architecture glossary the agent maps issue areas onto. Knowledge entries anchor to a component; the entry's product_area path is derived from this hierarchy.`,
    labels: `Per-${t("product")} advisory tag vocabulary. Tags stay free-form, but the agent reuses these slugs instead of inventing near-duplicates.`,
    patterns: "Controlled vocabulary for HOW issues get resolved (rollback, config-fix…). The agent may only pick existing slugs - it never invents one.",
    customers: "Companies that report tickets, auto-matched onto work items by email domain or alias. Deliberately cross-product: one customer can use several products.",
    users: "Who can sign in, and what they may do globally. Admins manage users, org structure and settings; members use the app.",
    membership: `Links users to the ${t("teams")} they work in. A team role of admin makes someone a team mini-admin: they curate that ${t("team")}'s knowledge, docs, taxonomy and members - without org-wide admin rights.`,
    system: "Runtime settings live in the database (editable here, admin only); env shows the value still winning as a fallback. Secrets and bootstrap config stay in .env - only whether they're set is shown.",
  });

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
    const system: Group = { key: "system", label: "System", sections: [{ key: "system", label: "settings" }] };
    return [org, taxonomy, people, ...(isGlobalAdmin ? [system] : [])];
  });

  let activeGroup = $state("org");
  let active = $state<Section>("teams");

  const currentGroup = $derived(groups.find((g) => g.key === activeGroup) ?? groups[0]);

  function pickGroup(key: string) {
    activeGroup = key;
    const g = groups.find((x) => x.key === key);
    if (g && !g.sections.some((s) => s.key === active)) active = g.sections[0].key;
  }
</script>

<div class="admin-root">
  <div class="groups">
    {#each groups as g (g.key)}
      <button class:active={activeGroup === g.key} onclick={() => pickGroup(g.key)}>{g.label}</button>
    {/each}
  </div>
  {#if currentGroup.sections.length > 1}
    <div class="sections">
      {#each currentGroup.sections as s (s.key)}
        <button class:active={active === s.key} onclick={() => (active = s.key)}>{s.label}</button>
      {/each}
    </div>
  {/if}

  <p class="explainer muted">{EXPLAINERS[active]}</p>

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
  {/if}
</div>

<style>
  .groups { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
  .groups button.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .sections { display: flex; gap: 0.35rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
  .sections button { font-size: 0.8rem; padding: 0.2rem 0.6rem; }
  .sections button.active { border-color: var(--accent); color: var(--accent); }
  .explainer { margin: 0 0 0.9rem; font-size: 0.82rem; line-height: 1.5; max-width: 60rem; }
  .muted { color: var(--muted); }

  /* Shared look for all panels, so each one stays lean. */
  .admin-root :global(table) { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-bottom: 0.75rem; }
  .admin-root :global(th), .admin-root :global(td) {
    text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top;
  }
  .admin-root :global(th) { color: var(--muted); font-weight: 500; }
  .admin-root :global(.tip) { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
  .admin-root :global(.mini) { font-size: 0.75rem; padding: 0.15rem 0.5rem; }
  .admin-root :global(.danger-btn) { border-color: var(--danger); color: var(--danger); }
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
</style>
