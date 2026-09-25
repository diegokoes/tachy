<script lang="ts">
  import StarField from "../StarField.svelte";
  import { Field, Note, Button, Icon } from "../tui";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { openSection } from "../router.svelte";
  import { toast } from "../notify.svelte";
  import { gsap, reducedMotion } from "../gsap";
  import BugIdeaToggle from "./BugIdeaToggle.svelte";
  import type { ReportReview, ReportType } from "@tachy/contract";

  let type = $state<ReportType | null>(null);
  let title = $state("");
  let body = $state("");
  let review = $state<ReportReview | null>(null);
  let reviewing = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let headingEl = $state<HTMLElement>();

  const canSend = $derived(
    type !== null && title.trim().length > 0 && body.trim().length > 0 && !busy,
  );

  $effect(() => {
    if (headingEl && !reducedMotion())
      gsap.from(headingEl, { opacity: 0, y: 16, duration: 0.6, ease: "power2.out" });
  });

  function leave() {
    const from = sessionStorage.getItem("tachy-feedback-from");
    const key =
      from && from !== "/feedback"
        ? from.slice(1).split("/")[0] || "chat"
        : "chat";
    openSection(key);
  }

  const held = $derived(
    !!review && review.available && review.suggestions.length > 0,
  );

  // Every draft is reviewed before it goes. Suggestions hold the first send so
  // the person can act on them; sending again with the draft unchanged files it
  // as is. Editing the draft drops the review, so the next send asks afresh.
  $effect(() => {
    void type;
    void title;
    void body;
    review = null;
  });

  async function send() {
    if (type === null || !title.trim() || !body.trim()) return;
    busy = true;
    error = null;
    try {
      if (!review) {
        reviewing = true;
        const draft = { type, title: title.trim(), body: body.trim() };
        review = await api.post<ReportReview>("/reports/review", draft);
        reviewing = false;
        if (held) return;
      }
      await api.post("/reports", {
        type,
        title: title.trim(),
        body: body.trim(),
        context: {
          from: sessionStorage.getItem("tachy-feedback-from") ?? null,
          href: window.location.href,
          user_agent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          env: session_badge(),
        },
        review: review ?? undefined,
      });
      toast(
        type === "bug"
          ? "bug report filed — thank you!"
          : "feature request filed — thank you!",
        "ok",
      );
      leave();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
      reviewing = false;
    }
  }

  function session_badge(): string | null {
    return (
      document.querySelector<HTMLElement>(".dev-badge")?.textContent ?? null
    );
  }
</script>

<StarField intense />

<div class="feedback">
  <button class="close" onclick={leave} title="close" aria-label="close">
    <Icon name="cancel" size="1.4em" weight={6} />
  </button>

  <div class="sheet">
    <h1 class="heading" bind:this={headingEl}>
      REPORT&nbsp;A
    </h1>

    <BugIdeaToggle bind:value={type} />

    <div class="form" class:dimmed={type === null}>
      <Field label="title" required>
        <input
          type="text"
          maxlength="200"
          bind:value={title}
          disabled={type === null}
        />
      </Field>

      <Field
        label={type === "feature"
          ? "what would you like, and why?"
          : "what happened?"}
        required
      >
        <textarea
          rows="7"
          bind:value={body}
          disabled={type === null}
        ></textarea>
      </Field>

      {#if review && held}
        <Note tone="warn">
          A few things that would help whoever picks this up — add them, or send
          as it is:
          <ul class="tips">
            {#each review.suggestions as s}
              <li>{s}</li>
            {/each}
          </ul>
        </Note>
      {/if}

      {#if error}
        <Note tone="danger">{error}</Note>
      {/if}

      <div class="actions">
        <Button
          variant="primary"
          icon="send"
          {busy}
          disabled={!canSend}
          onclick={send}
        >
          {reviewing ? "reviewing…" : held ? "send anyway" : "send report"}
        </Button>
      </div>
    </div>
  </div>
</div>

<style>
  .feedback {
    position: relative;
    z-index: 1;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--pad-4) clamp(1rem, 4vw, 3rem);
  }

  .close {
    position: absolute;
    top: var(--pad-4);
    right: var(--pad-4);
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: var(--pad-2);
    line-height: 0;
  }
  .close:hover {
    color: var(--text);
  }

  /* No panel chrome: the sheet floats on the sky, so the space reads as the
     surface rather than a card laid over it. */
  .sheet {
    width: 100%;
    max-width: 34rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-5, 1.6rem);
  }

  .heading {
    margin: 0;
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    letter-spacing: 0.14em;
    font-weight: 700;
    color: var(--text);
  }

  .form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    transition: opacity 0.4s ease;
  }
  /* Until a side is chosen the fields are there but plainly inert. */
  .form.dimmed {
    opacity: 0.45;
    pointer-events: none;
  }

  .tips {
    margin: var(--pad-1) 0 0;
    padding-left: 1.1rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--pad-3);
  }
</style>
