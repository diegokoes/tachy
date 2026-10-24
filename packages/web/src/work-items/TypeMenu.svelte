<script lang="ts">
  import type { WorkItemTypeOption } from "@tachy/contract";
  import { Menu, type MenuItem } from "../tui";
  import { router } from "../shell/router.svelte";
  import { ensureTypes, typesNote, typesOf } from "./az.svelte";
  import { typeColor, typeIcon } from "./ado-icons";

  let {
    projectId,
    onpick,
  }: { projectId: string; onpick: (type: WorkItemTypeOption) => void } =
    $props();

  let shown = $state(false);

  const types = $derived(typesOf(projectId));
  const items = $derived<MenuItem[]>(
    types.map((type) => ({
      key: type.name,
      label: type.name,
      icon: typeIcon(type.icon),
      color: typeColor(type.color) ?? undefined,
    })),
  );

  $effect(() => {
    void router.path;
    shown = false;
  });

  $effect(() => {
    if (shown) void ensureTypes(projectId);
  });

  export function open() {
    shown = true;
  }

  function pick(name: string) {
    const type = types.find((t) => t.name === name);
    if (type) onpick(type);
  }
</script>

<Menu
  label="new"
  icon="plus"
  tone="ok"
  {items}
  empty={typesNote(projectId)}
  bind:open={shown}
  onpick={pick}
/>
