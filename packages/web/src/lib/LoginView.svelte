<script lang="ts">
  import { session, login } from "./session.svelte";

  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      await login(email.trim(), password);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="login-wrap">
  <div class="login-card">
    <div class="wordmark">tachy</div>

    {#if session.config?.passwordLogin}
      <form onsubmit={submit}>
        <label>
          <span>email</span>
          <input type="email" bind:value={email} autocomplete="username" required />
        </label>
        <label>
          <span>password</span>
          <input type="password" bind:value={password} autocomplete="current-password" required />
        </label>
        {#if error}<p class="error">{error}</p>{/if}
        <button type="submit" class="primary" disabled={busy || !email.trim() || !password}>
          {busy ? "signing in…" : "sign in"}
        </button>
      </form>
    {/if}

    {#if session.config?.sso}
      <a class="sso" href="/auth/login?redirect=%2F">sign in with SSO →</a>
    {/if}

    {#if !session.config?.passwordLogin && !session.config?.sso}
      <p class="muted">No login method is configured. Set TACHY_API_TOKEN or OIDC_* in the environment, or run the setup wizard.</p>
    {/if}
  </div>
</div>

<style>
  .login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .login-card {
    width: min(24rem, 100%);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 2rem 2.2rem 1.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .wordmark {
    color: var(--accent);
    font-size: 2rem;
    letter-spacing: 0.04em;
  }
  .sub { margin: -0.6rem 0 0.4rem; font-size: 0.85rem; }
  form { display: flex; flex-direction: column; gap: 0.8rem; }
  label { display: flex; flex-direction: column; gap: 0.3rem; }
  label span { font-size: 0.8rem; color: var(--muted); }
  .primary {
    margin-top: 0.3rem;
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-dim);
  }
  .sso { font-size: 0.9rem; }
  .error { color: var(--danger); font-size: 0.85rem; margin: 0; }
  .muted { color: var(--muted); }
</style>
