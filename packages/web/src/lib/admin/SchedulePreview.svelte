<script lang="ts">
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Note } from "../tui";

  let { schedule, timezone }: { schedule: unknown; timezone: unknown } = $props();

  let next = $state<string[]>([]);
  let error = $state<string | null>(null);

  $effect(() => {
    const s = String(schedule ?? "").trim();
    const tz = String(timezone || "UTC");
    next = [];
    error = null;
    if (!s) return;
    const timer = setTimeout(async () => {
      try {
        next = (await api.post<{ next: string[] }>("/jobs/schedule-preview", { schedule: s, timezone: tz })).next;
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
  <Note>next: {next.slice(0, 3).map((d) => new Date(d).toLocaleString()).join(" · ")}</Note>
{/if}
