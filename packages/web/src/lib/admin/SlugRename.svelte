<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { api } from "../api";
  import { Modal, Field, Note } from "../tui";
  import { slugify } from "../slug";
  import { errText } from "../resource.svelte";

  export type RenameImpact = { entries: number; docs?: number };

  let {
    title = "rename slug",
    current,
    taken = [],
    warning,
    impact: impactPath,
    message,
    onRename,
    onDone,
    onCancel,
  }: {
    title?: string;
    current: string;
    /** Sibling slugs — the create routes upsert, so a clash would overwrite. */
    taken?: string[];
    warning?: string;
    /** Resource path whose `/rename-impact` counts what a rename rewrites. */
    impact?: string;
    message?: Snippet<[RenameImpact, string]>;
    onRename: (slug: string) => Promise<void>;
    onDone: () => void;
    onCancel: () => void;
  } = $props();

  // Seeded once on purpose: the dialog is mounted fresh per rename, and the
  // field is the user's to change from there.
  // svelte-ignore state_referenced_locally
  let value = $state(current);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let impact = $state<RenameImpact | null>(null);

  const clash = $derived(value !== current && taken.includes(value));
  const blocked = $derived(!value || value === current || clash);

  onMount(async () => {
    if (!impactPath) return;
    try {
      impact = await api.get<RenameImpact>(`${impactPath}/rename-impact`);
    } catch (e) {
      error = errText(e);
    }
  });

  async function confirm() {
    busy = true;
    error = null;
    try {
      await onRename(value);
      onDone();
    } catch (e) {
      error = errText(e);
      busy = false;
    }
  }
</script>

<Modal
  {title}
  confirmLabel="rename"
  confirmIcon="edit"
  danger
  {busy}
  disabled={blocked}
  width="32rem"
  onConfirm={confirm}
  {onCancel}
>
  {#if error}<Note tone="danger">{error}</Note>{/if}

  <Field
    label="new slug"
    hint={clash ? undefined : `was ${current}`}
    error={clash ? "already taken" : null}
  >
    <input
      type="text"
      aria-label="new slug"
      value={value}
      oninput={(e) => (value = slugify(e.currentTarget.value))}
    />
  </Field>

  {#if impact && message}
    {@render message(impact, value || current)}
  {/if}
  {#if warning}<Note tone="warn">{warning}</Note>{/if}
</Modal>
