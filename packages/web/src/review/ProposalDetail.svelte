<script lang="ts">
  import type { ProposalRow } from "@tachy/contract";
  import { api } from "../api";
  import { draftFrom } from "../knowledge/draft";
  import type { KnowledgeRow } from "../knowledge/rows";
  import { createSequence, errText } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import { Badge, Button, Field, Note, Time } from "../tui";
  import { fieldLabels, proposedChanges } from "./changes";
  import FieldChanges from "./FieldChanges.svelte";
  import { adviceLines, checkLine } from "./precheck";
  import { PROPOSAL_TONES, proposalPath } from "./queue";

  let { id, onChanged }: { id: string; onChanged: () => void } = $props();

  type Action =
    "accept" | "return" | "reject" | "resubmit" | "withdraw" | "messages";

  const MAX_MESSAGE_CHARS = 4000;

  let proposal = $state<ProposalRow | null>(null);
  let entry = $state<KnowledgeRow | null>(null);
  let error = $state<string | null>(null);
  let message = $state("");
  let acting = $state<Action | null>(null);

  const entryPath = $derived(
    proposal ? `/library/entries/${proposal.knowledge_entry_id}` : "",
  );
  const changes = $derived(
    proposal && entry ? proposedChanges(draftFrom(entry), proposal) : [],
  );
  const conflicts = $derived(proposal?.conflicting_fields ?? []);
  const checks = $derived(proposal?.precheck?.checks ?? []);
  const remarks = $derived(
    adviceLines(proposal?.precheck ?? null, {
      waiting: proposal?.status === "open",
    }),
  );
  const isPending = $derived(
    proposal?.status === "open" || proposal?.status === "returned",
  );
  const decides = $derived(
    proposal?.status === "open" && proposal.viewer?.reviewer === true,
  );
  const isOwn = $derived(isPending && proposal?.viewer?.submitter === true);
  const hasMessage = $derived(message.trim().length > 0);

  const current = createSequence();

  async function load() {
    const isCurrent = current();
    try {
      const loaded = await api.get<ProposalRow>(`/review/proposals/${id}`);
      const row = await api.get<KnowledgeRow>(
        `/knowledge/${loaded.knowledge_entry_id}`,
      );
      if (!isCurrent()) return;
      proposal = loaded;
      entry = row;
      error = null;
    } catch (e) {
      if (!isCurrent()) return;
      proposal = null;
      error = errText(e);
    }
  }

  async function act(action: Action, body: Record<string, unknown> = {}) {
    acting = action;
    error = null;
    try {
      await api.post(`/review/proposals/${id}/${action}`, body);
      message = "";
      await load();
      onChanged();
    } catch (e) {
      error = errText(e);
    } finally {
      acting = null;
    }
  }

  const withMessage = (action: Action) =>
    act(action, { message: message.trim() });

  $effect(() => {
    void id;
    message = "";
    load();
  });
</script>

<article class="proposal">
  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if proposal}
    <header>
      <h2>
        <a
          href={entryPath}
          onclick={(e) => {
            e.preventDefault();
            navigate(entryPath);
          }}>{proposal.entry_title}</a
        >
      </h2>
      <p class="facts">
        <Badge>{proposal.kind === "new" ? "new entry" : "change"}</Badge>
        <Badge tone={PROPOSAL_TONES[proposal.status]}>{proposal.status}</Badge>
        <span>
          {proposal.submitter_name ?? "someone"} via {proposal.actor}
          · <Time at={proposal.created_at} />
        </span>
      </p>
      {#if proposal.decided_at}
        <p class="facts">
          {proposal.status} by {proposal.decider_name ?? "someone"}
          · <Time at={proposal.decided_at} />
        </p>
      {/if}
      {#if proposal.note}<blockquote>{proposal.note}</blockquote>{/if}
    </header>

    {#if conflicts.length}
      <Note tone="warn">
        the entry changed since this was proposed, in
        {fieldLabels(conflicts).join(", ")}: edit it to settle which value
        stands
      </Note>
    {/if}

    {#if checks.length || remarks.length}
      <section class="precheck">
        <h3>pre-check</h3>
        <ul>
          {#each checks as finding (finding.code)}
            <li>
              {checkLine(finding)}
              {#each finding.copies ?? [] as copy (copy.id)}
                {@const copyPath = `/library/entries/${copy.id}`}
                <a
                  href={copyPath}
                  onclick={(e) => {
                    e.preventDefault();
                    navigate(copyPath);
                  }}>{copy.title}</a
                >
              {/each}
            </li>
          {/each}
          {#each remarks as remark}
            <li class="remark">{remark}</li>
          {/each}
        </ul>
      </section>
    {/if}

    <FieldChanges {changes} />

    {#if proposal.messages?.length}
      <div class="thread">
        {#each proposal.messages as posted (posted.id)}
          <div class="msg {posted.direction}">
            <span class="from">
              {posted.author_name ?? posted.direction}
              · <Time at={posted.created_at} />
            </span>
            <p>{posted.body_text}</p>
          </div>
        {/each}
      </div>
    {/if}

    {#if isPending}
      <div class="reply">
        <Field
          label="message"
          info="sent to the other side with a reply; sending back and rejecting need one"
        >
          <textarea rows="3" maxlength={MAX_MESSAGE_CHARS} bind:value={message}
          ></textarea>
        </Field>
        <div class="acts">
          {#if decides}
            <Button
              variant="primary"
              icon="approve"
              busy={acting === "accept"}
              disabled={conflicts.length > 0}
              onclick={() => act("accept")}>accept</Button
            >
            <Button
              icon="edit"
              onclick={() => navigate(`${proposalPath(id)}/edit`)}
              >edit + accept</Button
            >
            <Button
              icon="back"
              tone="warn"
              busy={acting === "return"}
              disabled={!hasMessage}
              onclick={() => withMessage("return")}>send back</Button
            >
            <Button
              icon="reject"
              tone="danger"
              busy={acting === "reject"}
              disabled={!hasMessage}
              onclick={() => withMessage("reject")}>reject</Button
            >
          {/if}
          {#if isOwn}
            {#if proposal.status === "returned"}
              <Button
                variant="primary"
                icon="send"
                busy={acting === "resubmit"}
                onclick={() =>
                  act("resubmit", hasMessage ? { note: message.trim() } : {})}
                >resubmit</Button
              >
            {/if}
            <Button icon="edit" onclick={() => navigate(entryPath)}>edit</Button
            >
            <Button
              icon="reset"
              tone="danger"
              busy={acting === "withdraw"}
              onclick={() => act("withdraw")}>withdraw</Button
            >
          {/if}
          <Button
            variant="ghost"
            icon="send"
            busy={acting === "messages"}
            disabled={!hasMessage}
            onclick={() => withMessage("messages")}>reply</Button
          >
        </div>
      </div>
    {/if}
  {:else if !error}
    <p class="muted">loading…</p>
  {/if}
</article>

<style>
  .proposal {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
    max-width: 88ch;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-2);
  }
  h2 a {
    color: inherit;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-1);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  blockquote {
    margin: var(--pad-2) 0 0;
    padding-left: var(--pad-3);
    border-left: 2px solid var(--border);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .precheck h3 {
    margin: 0 0 var(--pad-1);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--warn);
  }
  .precheck ul {
    margin: 0;
    padding-left: var(--pad-4);
    font-size: var(--fs-sm);
  }
  .precheck .remark {
    color: var(--muted);
  }
  .thread {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .msg {
    border-radius: var(--radius);
    padding: var(--pad-2) var(--pad-3);
    background: color-mix(in srgb, var(--rule) 8%, transparent);
  }
  .msg.reviewer {
    border-left: 3px solid var(--accent);
  }
  .msg p {
    margin: var(--pad-1) 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .from {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .reply textarea {
    width: 100%;
    min-width: 0;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-2);
    margin-top: var(--pad-2);
  }
  .muted {
    color: var(--muted);
  }
</style>
