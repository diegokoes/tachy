<script lang="ts">
  import { keyLabel } from "../keys/bindings.svelte";
  import { vimState, setVim } from "../vim.svelte";
  import { Checkbox, VimMark } from "../tui";

  /* Real chords, not pre-formatted display strings: they go through the same
     speller as a rebindable key, so the two lists cannot drift apart. */
  const VIM: { keys: string[]; what: string }[] = [
    { keys: ["j", "k"], what: "move the cursor down / up" },
    { keys: ["g g", "shift+g"], what: "first / last row" },
    { keys: ["⏎", "esc"], what: "open / back" },
    { keys: ["/"], what: "focus the search box" },
    { keys: ["n", "shift+n"], what: "next / previous match" },
    { keys: ["h", "l"], what: "previous / next section" },
    { keys: ["shift+h", "shift+l"], what: "previous / next subnav tab" },
    { keys: ["ctrl+d", "ctrl+u"], what: "scroll half a page" },
  ];
</script>

<label class="toggle">
  <Checkbox
    checked={vimState.enabled}
    ariaLabel="vim controls"
    onchange={setVim}
  />
  <VimMark size="1.4em" />
  <span>Navigate lists and sections with vim motions</span>
</label>

<ul class="ref" class:off={!vimState.enabled}>
  {#each VIM as r}
    <li>
      <kbd>{r.keys.map(keyLabel).join(" / ")}</kbd><span>{r.what}</span>
    </li>
  {/each}
</ul>

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--gap);
    cursor: pointer;
  }

  .ref {
    list-style: none;
    margin: var(--pad-3) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .ref.off {
    opacity: 0.5;
  }
  .ref li {
    display: flex;
    align-items: baseline;
    gap: var(--gap);
  }
  .ref kbd {
    flex: 0 0 13rem;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .ref span {
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  @media (max-width: 34rem) {
    .ref li {
      flex-direction: column;
      gap: 0;
    }
    .ref kbd {
      flex: none;
    }
  }
</style>
