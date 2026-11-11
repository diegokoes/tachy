<script lang="ts">
  import { Badge } from "../tui";
  import type { FieldChange } from "./changes";

  let { changes }: { changes: FieldChange[] } = $props();
</script>

<dl class="changes">
  {#each changes as change (change.field)}
    <div class="change">
      <dt>
        {change.label}
        {#if change.conflicting}<Badge tone="warn">changed since</Badge>{/if}
      </dt>
      <!-- One line: the value is pre-wrapped, so markup whitespace would show. -->
      <dd class:lines={change.isList || change.isRewrite}>
        {#each change.parts as part}{#if part.change === "added"}<ins
              >{part.text}</ins
            >{:else if part.change === "removed"}<del>{part.text}</del
            >{:else}<span>{part.text}</span>{/if}{/each}
      </dd>
    </div>
  {/each}
</dl>

<style>
  .changes {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }
  dt {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: var(--pad-1);
  }
  dd {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  dd.lines > * {
    display: block;
  }
  ins {
    text-decoration: none;
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }
  del {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }
</style>
