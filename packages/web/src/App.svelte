<script lang="ts">
  import { onMount } from "svelte";

  // Minimal Phase-1 shell: confirms the SPA is served and the API is reachable.
  // Phase 3 fills in the Knowledge / Reference views; Phase 5 adds the Chat panel.
  let health = $state<"checking" | "ok" | "down">("checking");
  let me = $state<{ email?: string; name?: string } | null>(null);

  onMount(async () => {
    try {
      const res = await fetch("/health");
      health = res.ok ? "ok" : "down";
    } catch {
      health = "down";
    }
    try {
      const res = await fetch("/auth/me");
      if (res.ok) me = await res.json();
    } catch {
      /* auth not configured yet */
    }
  });
</script>

<header>
  <h1>tachy</h1>
  <div class="status">
    <span class="dot {health}"></span>
    api {health}
    {#if me?.email}<span class="user">· {me.name ?? me.email}</span>{/if}
  </div>
</header>

<main>
  <p class="muted">Knowledge engine. Panels land in the next phases.</p>
</main>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  h1 {
    margin: 0;
    font-size: 1.1rem;
    letter-spacing: 0.02em;
  }
  .status {
    font-size: 0.85rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .user {
    color: var(--text);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.ok {
    background: #3fb950;
  }
  .dot.down {
    background: #f85149;
  }
  main {
    padding: 1.25rem;
  }
  .muted {
    color: var(--muted);
  }
</style>
