<script lang="ts">
  import { onMount } from "svelte";
  import ChatView from "./lib/ChatView.svelte";
  import KnowledgeView from "./lib/KnowledgeView.svelte";
  import ReferenceView from "./lib/ReferenceView.svelte";
  import AdminView from "./lib/AdminView.svelte";

  type View = "chat" | "knowledge" | "reference" | "admin";
  const nav: { key: View; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "knowledge", label: "Knowledge" },
    { key: "reference", label: "Reference" },
    { key: "admin", label: "Admin" },
  ];

  let view = $state<View>("knowledge");
  let health = $state<"checking" | "ok" | "down">("checking");
  let me = $state<{ email?: string; name?: string } | null>(null);
  let authMode = $state<"sso" | "token" | "open">("open");

  const loginHref = () => `/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;

  onMount(async () => {
    try {
      health = (await fetch("/health")).ok ? "ok" : "down";
    } catch {
      health = "down";
    }
    try {
      authMode = (await (await fetch("/auth/config")).json()).authMode;
    } catch {
      /* default open */
    }
    if (authMode === "sso") {
      try {
        const res = await fetch("/auth/me");
        if (res.ok) me = await res.json();
      } catch {
        /* not signed in */
      }
    }
  });
</script>

<div class="app">
  <aside>
    <div class="brand">tachy</div>
    <nav>
      {#each nav as n}
        <button class:active={view === n.key} onclick={() => (view = n.key)}>{n.label}</button>
      {/each}
    </nav>
  </aside>

  <div class="main">
    <header>
      <div class="status">
        <span class="dot {health}"></span> api {health}
      </div>
      <div class="auth">
        {#if authMode === "sso"}
          {#if me?.email}
            <span class="user">{me.name ?? me.email}</span>
            <a href="/auth/logout">Sign out</a>
          {:else}
            <a href={loginHref()}>Sign in</a>
          {/if}
        {/if}
      </div>
    </header>

    <main>
      {#if view === "knowledge"}
        <KnowledgeView />
      {:else if view === "reference"}
        <ReferenceView />
      {:else if view === "admin"}
        <AdminView />
      {:else}
        <ChatView />
      {/if}
    </main>
  </div>
</div>

<style>
  .app { display: grid; grid-template-columns: 200px 1fr; height: 100vh; }
  aside { background: var(--panel); border-right: 1px solid var(--border); padding: 1rem 0.75rem; display: flex; flex-direction: column; gap: 1rem; }
  .brand { font-weight: 600; letter-spacing: 0.04em; padding: 0 0.25rem; }
  nav { display: flex; flex-direction: column; gap: 0.25rem; }
  nav button { text-align: left; border-color: transparent; background: transparent; }
  nav button.active { background: var(--accent-dim); color: var(--text); }
  .main { display: flex; flex-direction: column; min-width: 0; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 1.25rem; border-bottom: 1px solid var(--border); }
  .status { font-size: 0.82rem; color: var(--muted); display: flex; align-items: center; gap: 0.4rem; }
  .auth { font-size: 0.85rem; display: flex; gap: 0.6rem; align-items: center; }
  .user { color: var(--text); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .dot.ok { background: #3fb950; }
  .dot.down { background: #f85149; }
  main { padding: 1.25rem; overflow: auto; }
</style>
