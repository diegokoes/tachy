<script lang="ts">
  import { session, login } from "./session.svelte";
  import { errText } from "./resource.svelte";
  import AuthShell from "./AuthShell.svelte";
  import { Button, Field, Note, Panel } from "./tui";

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
      error = errText(err);
    } finally {
      busy = false;
    }
  }
</script>

<AuthShell>
  <div class="login">
    <Panel>
      <div class="wordmark">tachy</div>

      {#if session.config?.passwordLogin}
        <form onsubmit={submit}>
          <Field label="email">
            <input
              type="email"
              bind:value={email}
              autocomplete="username"
              required
            />
          </Field>
          <Field label="password">
            <input
              type="password"
              bind:value={password}
              autocomplete="current-password"
              required
            />
          </Field>
          {#if error}<Note tone="danger">{error}</Note>{/if}
          <div class="submit">
            <Button
              type="submit"
              variant="primary"
              square
              icon="go"
              aria-label="sign in"
              title="sign in"
              {busy}
              disabled={!email.trim() || !password}
            />
          </div>
        </form>
      {/if}

      {#if session.config?.sso}
        <a class="sso" href="/auth/login?redirect=%2F">sign in with SSO →</a>
      {/if}

      {#if !session.config?.passwordLogin && !session.config?.sso}
        <Note tone="warn">
          No login method is configured. Set TACHY_API_TOKEN or OIDC_* in the
          environment, or run the setup wizard.
        </Note>
      {/if}
    </Panel>
  </div>
</AuthShell>

<style>
  .login {
    width: min(24rem, 100%);
  }
  .wordmark {
    color: var(--accent);
    font-size: 2rem;
    letter-spacing: 0.04em;
    margin-bottom: var(--pad-3);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  /* Clears the password field — the button sat right on top of it. */
  .submit {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--pad-3);
  }
  .sso {
    display: inline-block;
    margin-top: var(--pad-3);
    font-size: var(--fs-sm);
  }
</style>
