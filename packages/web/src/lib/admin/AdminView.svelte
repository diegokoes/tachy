<script lang="ts">
  import { navigate, segment } from "../router.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import { Panel } from "../tui";
  import { setSubnav } from "../subnav.svelte";
  import ConnectPage from "./ConnectPage.svelte";
  import TeamsPanel from "./TeamsPanel.svelte";
  import ProductsPanel from "./ProductsPanel.svelte";
  import ComponentsPanel from "./ComponentsPanel.svelte";
  import LabelsPanel from "./LabelsPanel.svelte";
  import PatternsPanel from "./PatternsPanel.svelte";
  import CustomersPanel from "./CustomersPanel.svelte";
  import AccessPanel from "./AccessPanel.svelte";
  import SystemPanel from "./SystemPanel.svelte";
  import CredentialsPanel from "./CredentialsPanel.svelte";

  const PAGES = [
    { key: "connect", label: "connect" },
    { key: "structure", label: "structure" },
    { key: "access", label: "access" },
  ];

  const page = $derived(segment(1) ?? "connect");

  $effect(() =>
    setSubnav({
      items: PAGES,
      active: page,
      onpick: (k) => navigate(`/admin/${k}`),
    }),
  );
  const admin = $derived(isGlobalAdmin());
</script>

<div class="admin-root">
  {#if page === "structure"}
    <div class="stack">
      <Panel title={t("teams")}><TeamsPanel /></Panel>
      <Panel title={t("products")}><ProductsPanel /></Panel>
      <Panel title="components"><ComponentsPanel /></Panel>
      <Panel title="labels"><LabelsPanel /></Panel>
      <Panel title="resolution patterns"><PatternsPanel /></Panel>
      {#if showCustomer()}
        <Panel title={t("customers")}><CustomersPanel /></Panel>
      {/if}
    </div>
  {:else if page === "access"}
    <div class="stack">
      <Panel title="users & roles"><AccessPanel /></Panel>
      <Panel title="shared credentials"><CredentialsPanel /></Panel>
      {#if admin}
        <Panel title="system settings"><SystemPanel /></Panel>
      {/if}
    </div>
  {:else}
    <ConnectPage />
  {/if}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
  }

  /* Chrome for the two panels still on hand-rolled markup: system settings
     and shared credentials. Both are singleton forms, not record lists.
     Deleted as each one moves over. */
  .admin-root :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
    margin-bottom: var(--pad-3);
  }
  .admin-root :global(th),
  .admin-root :global(td) {
    text-align: left;
    padding: var(--pad-2) var(--pad-3);
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .admin-root :global(th) {
    color: var(--muted);
    font-weight: 500;
  }
  .admin-root :global(.tip) {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: help;
  }
  .admin-root :global(.mini) {
    font-size: var(--fs-xs);
    padding: var(--pad-1) var(--pad-3);
  }
  .admin-root :global(h4) {
    margin: var(--pad-3) 0 var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }
  .admin-root :global(.muted) {
    color: var(--muted);
  }
  .admin-root :global(.error) {
    color: var(--danger);
  }
</style>
