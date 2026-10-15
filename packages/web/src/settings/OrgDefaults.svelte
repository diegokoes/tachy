<script lang="ts">
  import { DATE_ORDER_LABELS } from "@tachy/contract";
  import { errText } from "../resource.svelte";
  import { clearOrgDefaults, saveOrgDefaults } from "../theme/defaults";
  import { FAMILIES } from "../theme/fonts.svelte";
  import { orgAppearance } from "../theme/org.svelte";
  import { Button, Note } from "../tui";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  let busy = $state(false);
  let error = $state<string | null>(null);

  const org = $derived(orgAppearance.value);
  const isSet = $derived(Object.keys(org).length > 0);
  const summary = $derived(
    [
      org.theme,
      org.accent && [org.accent, org.accent2].filter(Boolean).join(" → "),
      org.nav_labels && `labels ${org.nav_labels}`,
      FAMILIES.ui.find((f) => f.key === org.font_ui)?.label,
      org.date_order && DATE_ORDER_LABELS[org.date_order],
      org.clock,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  async function run(change: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await change();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }
</script>

<Rows>
  <Row label="in use">
    <span class="summary">{isSet ? summary : "built-in"}</span>
    {#snippet actions()}
      {#if isSet}
        <Button
          variant="ghost"
          square
          icon="reset"
          title="clear org defaults"
          disabled={busy}
          onclick={() => run(clearOrgDefaults)}
        />
      {/if}
    {/snippet}
  </Row>

  <Row label="publish" hint="mode, text size, nav, accent, fonts, dates">
    <Button icon="save" {busy} onclick={() => run(saveOrgDefaults)}>
      save mine as defaults
    </Button>
  </Row>
</Rows>

{#if error}<Note tone="danger">{error}</Note>{/if}

<style>
  .summary {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
    text-align: right;
  }
</style>
