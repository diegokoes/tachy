<script lang="ts">
  import { LIBRARY_FILE_TYPES, type CustomerFiled } from "@tachy/contract";
  import { link } from "../shell/router.svelte";
  import Group from "../settings/Group.svelte";
  import { Button, Icon, Menu, tip } from "../tui";

  let {
    documents,
    current,
    unitName,
    uploadProducts,
    busy,
    onupload,
  }: {
    documents: CustomerFiled["documents"];
    /** The unit in view, whose own docs need no "on" line; null for the customer. */
    current: string | null;
    unitName: (slug: string) => string;
    /** The products an upload here may be filed under; none hides the upload. */
    uploadProducts: { value: string; label: string }[];
    busy: boolean;
    onupload: (file: File, product: string) => void;
  } = $props();

  let picker = $state<HTMLInputElement | null>(null);
  let product = $state("");

  /** Opens the file picker for a doc filed under `pick`; the upload starts once a file is chosen. */
  function choose(pick: string) {
    product = pick;
    picker?.click();
  }

  function picked() {
    const file = picker?.files?.[0];
    if (file && product) onupload(file, product);
    if (picker) picker.value = "";
  }
</script>

<Group label="documents">
  {#snippet action()}
    {#if uploadProducts.length === 1}
      <Button
        variant="ghost"
        size="sm"
        square
        icon="attach"
        title="upload a document"
        {busy}
        onclick={() => choose(uploadProducts[0].value)}
      />
    {:else if uploadProducts.length}
      <Menu
        label="upload a document under"
        icon="attach"
        items={uploadProducts.map((p) => ({ key: p.value, label: p.label }))}
        onpick={choose}
      >
        {#snippet face()}{/snippet}
      </Menu>
    {/if}
  {/snippet}
  <!-- The native control is unstyleable; the button above opens it. -->
  <input
    class="picker"
    type="file"
    accept={LIBRARY_FILE_TYPES.join(",")}
    aria-label="document to upload"
    bind:this={picker}
    onchange={picked}
  />
  {#each documents as doc (doc.id)}
    <div class="item">
      <Icon name="refDoc" size="1em" />
      <a href="/library/docs/{doc.id}" use:link>{doc.title}</a>
      {#if doc.unit && doc.unit !== current}
        <span class="where">on {unitName(doc.unit)}</span>
      {/if}
      {#if doc.original}
        <a
          class="original"
          href="/api/reference/{doc.id}/file"
          download
          aria-label="download the original"
          use:tip={"download the original"}
          ><Icon name="download" size="1em" /></a
        >
      {/if}
    </div>
  {:else}
    <p class="none">none filed</p>
  {/each}
</Group>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) 0;
  }
  .where,
  .none {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .none {
    margin: 0;
  }
  .original {
    display: inline-flex;
    margin-left: auto;
    color: var(--muted);
  }
  .original:hover {
    color: var(--text);
  }
  .picker {
    display: none;
  }
</style>
