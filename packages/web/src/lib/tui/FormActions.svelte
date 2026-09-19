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
    oncancel,
  }: {
    form: string;
    saving?: boolean;
    title?: string;
    oncancel: () => void;
  } = $props();
</script>

<Button icon="cancel" disabled={saving} onclick={oncancel}>cancel</Button>
<Button variant="primary" icon="save" type="submit" {form} {title} busy={saving}
  >save</Button
>
