<script lang="ts">
  import Button from "./Button.svelte";

  /**
   * Cancel and save for a form whose buttons App renders in the carved row
   * beside the subnav. Save sits outside the <form> in the DOM, so it names the
   * form by id: that keeps native required-field validation, which calling
   * submit() directly loses.
   */
  let {
    form,
    saving = false,
    title,
    create = false,
    oncancel,
  }: {
    form: string;
    saving?: boolean;
    title?: string;
    /** The record does not exist yet: save wears its plus. */
    create?: boolean;
    oncancel: () => void;
  } = $props();
</script>

<Button size="sm" variant="ghost" icon="close" disabled={saving} onclick={oncancel}
  >cancel</Button
>
<Button
  size="sm"
  variant="primary"
  icon={create ? "create" : "save"}
  type="submit"
  {form}
  {title}
  busy={saving}>save</Button
>
