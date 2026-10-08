<script lang="ts">
  import { fmtDateTime } from "../dates.svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Note } from "../tui";

  let { schedule, timezone }: { schedule: unknown; timezone: unknown } =
    $props();

  let next = $state<string[]>([]);
  let error = $state<string | null>(null);

  $effect(() => {
    const expression = String(schedule ?? "").trim();
    const zone = String(timezone ?? "").trim();
    next = [];
    error = null;
    if (!expression) return;
    const timer = setTimeout(async () => {
      try {
        next = (
          await api.post<{ next: string[] }>("/jobs/schedule-preview", {
            schedule: expression,
            ...(zone ? { timezone: zone } : {}),
          })
        ).next;
      } catch (e) {
        error = errText(e);
      }
    }, 300);
    return () => clearTimeout(timer);
  });
</script>

{#if error}
  <Note tone="danger">{error}</Note>
{:else if next.length}
  <Note>next: {next.slice(0, 3).map(fmtDateTime).join(" · ")} UTC</Note>
{/if}
