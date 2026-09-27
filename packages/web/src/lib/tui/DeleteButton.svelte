<script lang="ts">
  import { onDestroy } from "svelte";
  import Button from "./Button.svelte";

  /**
   * The trash can, for removing and deleting alike. Where the loss is real the
   * first click only arms it: the can morphs into a check, and a second click
   * inside a few seconds commits. `confirm={false}` is for rows of a form that
   * has not been saved yet, where nothing is lost until it is.
   */
  let {
    label,
    onclick,
    confirm = true,
    disabled = false,
    busy = false,
    iconSize,
  }: {
    /** What goes: "remove unit", "delete". Doubles as the accessible name. */
    label: string;
    onclick: () => void;
    confirm?: boolean;
    disabled?: boolean;
    busy?: boolean;
    iconSize?: string;
  } = $props();

  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function disarm() {
    armed = false;
    clearTimeout(timer);
  }

  function click() {
    if (confirm && !armed) {
      armed = true;
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    onclick();
  }

  onDestroy(disarm);
</script>

<span class="del" onfocusout={disarm}>
  <Button
    variant="ghost"
    tone="danger"
    square
    icon={armed ? "confirm" : "delete"}
    morph={confirm}
    {iconSize}
    {disabled}
    {busy}
    title={armed ? "click again to confirm" : label}
    aria-label={armed ? `confirm: ${label}` : label}
    onclick={click}
  />
</span>

<style>
  .del {
    display: contents;
  }
</style>
