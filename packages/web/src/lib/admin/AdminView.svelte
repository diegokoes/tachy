<script lang="ts">
  import { navigate, segment } from "../router.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import { Panel, Tabs } from "../tui";
  import ConnectPage from "./ConnectPage.svelte";
  import TeamsPanel from "./TeamsPanel.svelte";
  import ProductsPanel from "./ProductsPanel.svelte";
  import ComponentsPanel from "./ComponentsPanel.svelte";
  import LabelsPanel from "./LabelsPanel.svelte";
  import PatternsPanel from "./PatternsPanel.svelte";
  import CustomersPanel from "./CustomersPanel.svelte";
  import UsersPanel from "./UsersPanel.svelte";
  import MembershipPanel from "./MembershipPanel.svelte";
  import SystemPanel from "./SystemPanel.svelte";
  import CredentialsPanel from "./CredentialsPanel.svelte";

  const PAGES = [
    { key: "connect", label: "connect" },
    { key: "structure", label: "structure" },
    { key: "access", label: "access" },
  ];

  const page = $derived(segment(1) ?? "connect");
  const admin = $derived(isGlobalAdmin());
</script>

<div class="head">
  <Tabs
    items={PAGES}
    active={page}
    hotkeys="shift"
    onpick={(k) => navigate(`/admin/${k}`)}
  />
</div>

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
      {#if admin}
        <Panel title="users"><UsersPanel /></Panel>
      {/if}
      <Panel title="membership"><MembershipPanel /></Panel>
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
  .head {
    margin-bottom: var(--pad-4);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
  }

  /* Chrome for panels not yet migrated to the tui primitives (sources,
     projects, repos, users, membership, system, credentials). Deleted as each
     one moves over. */
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
  .admin-root :global(.danger-btn) {
    border-color: var(--danger);
    color: var(--danger);
  }
  .admin-root :global(.icon-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--row-h);
    height: var(--row-h);
    padding: 0;
    line-height: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--muted);
  }
  .admin-root :global(.icon-btn + .icon-btn) {
    margin-left: var(--pad-1);
  }
  .admin-root :global(.icon-btn:hover) {
    color: var(--text);
    border-color: var(--text);
  }
  .admin-root :global(.icon-btn.danger) {
    color: var(--danger);
    border-color: var(--danger);
  }
  .admin-root :global(.icon-btn.danger:hover) {
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }
  .admin-root :global(.icon-btn.ok) {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 45%, var(--border));
  }
  .admin-root :global(.icon-btn.ok:hover:not(:disabled)) {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }
  .admin-root :global(.icon-btn:disabled) {
    opacity: 0.4;
  }
  .admin-root :global(.icon-btn.danger.armed) {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--bg);
  }
  .admin-root :global(h4) {
    margin: var(--pad-3) 0 var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }
  /* The add control is a square + button, parked at the right edge. */
  .admin-root :global(.add-area) {
    margin-top: var(--pad-2);
    display: flex;
    justify-content: flex-end;
  }
  .admin-root :global(.add-form) {
    display: flex;
    gap: var(--gap);
    flex-wrap: wrap;
    align-items: center;
  }
  .admin-root :global(.add-form label) {
    display: flex;
    gap: var(--pad-2);
    align-items: center;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .admin-root :global(.add-form input) {
    min-width: 9rem;
  }
  .admin-root :global(.scope) {
    display: flex;
    align-items: baseline;
    gap: var(--pad-4);
    margin-bottom: var(--pad-3);
    flex-wrap: wrap;
  }
  .admin-root :global(.scope label) {
    display: flex;
    gap: var(--gap);
    align-items: baseline;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .admin-root :global(.hint) {
    font-size: var(--fs-xs);
  }
  .admin-root :global(.muted) {
    color: var(--muted);
  }
  .admin-root :global(.error) {
    color: var(--danger);
  }
  .admin-root :global(.row-edit) {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
    align-items: center;
  }
  .admin-root :global(.row-edit input) {
    min-width: 8rem;
    font-size: var(--fs-sm);
  }
  .admin-root :global(.row-input) {
    width: 100%;
    min-width: 5ch;
    font-size: var(--fs-sm);
  }
  .admin-root :global(td.actions) {
    white-space: nowrap;
  }
</style>
