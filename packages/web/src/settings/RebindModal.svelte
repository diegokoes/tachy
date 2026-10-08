<script lang="ts">
  import { Modal } from "../tui";
  import { keyLabel } from "../keys/bindings.svelte";
  import {
    boundKey,
    capture,
    close,
    letGo,
    release,
    customized,
    defaultKey,
    rebind,
    restore,
    save,
    type Target,
  } from "./rebind.svelte";
  import Chord from "./Chord.svelte";

  let { target }: { target: Target } = $props();

  const shown = $derived(rebind.held ?? rebind.pending ?? boundKey(target));
  // Mid-chord, with only a modifier down, the verdict on the last press no
  // longer describes what is on screen.
  const settled = $derived(!rebind.held || rebind.held === rebind.pending);
  const warning = $derived(settled ? rebind.warning : "");
  const ready = $derived(
    Boolean(rebind.pending) &&
      !rebind.warning &&
      rebind.pending !== boundKey(target),
  );

  // Capture phase on window, ahead of the app's hotkey dispatcher and the
  // dialog's own Enter/Escape handling, so a press meant as the new key never
  // also runs whatever it is currently bound to.
  $effect(() => {
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keyup", release, true);
    window.addEventListener("blur", letGo);
    return () => {
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("blur", letGo);
    };
  });
</script>

<Modal
  title="rebind {rebind.label}"
  width="30rem"
  confirmLabel="save"
  disabled={!ready}
  onConfirm={save}
  onCancel={close}
  destructive={customized(target)
    ? {
        label: `back to ${keyLabel(defaultKey(target))}`,
        icon: "reset",
        onclick: restore,
      }
    : undefined}
>
  <div class="stage">
    <p class="msg" class:warn={warning} role="status" aria-live="polite">
      {warning || (rebind.pending ? "" : "Press the new key.")}
    </p>
    <div class="keys" class:bad={warning}>
      <Chord
        chord={shown}
        size="lg"
        live={!warning}
        pressed={Boolean(rebind.held)}
      />
    </div>
  </div>
</Modal>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-4);
    padding: var(--pad-2) 0;
  }
  /* Holds its line when empty, so the caps do not jump as a warning comes and
     goes. */
  .msg {
    margin: 0;
    min-height: 1.5em;
    font-size: var(--fs-sm);
    color: var(--muted);
    text-align: center;
  }
  .msg.warn {
    color: var(--warn);
  }
  .keys {
    padding: var(--pad-3);
  }
  .keys.bad {
    opacity: 0.6;
  }
</style>
