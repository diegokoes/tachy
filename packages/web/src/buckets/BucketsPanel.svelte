<script lang="ts">
  import { onMount } from "svelte";
  import { bucketIngestPath, type BucketWithToken } from "@tachy/contract";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { t } from "../terms";
  import {
    Icon,
    Button,
    Checkbox,
    CrudTable,
    GroupHead,
    Modal,
    Note,
    Time,
    type Column,
  } from "../tui";
  import { slugify, uniqueSlug } from "../slug";
  import type { Bucket } from "./rows";
  import type { Team } from "../catalog/rows";
  import { INFO } from "../admin/help";
  import { sectionHoist } from "../admin/sectionAction.svelte";

  const buckets = createResource(() => api.get<Bucket[]>("/buckets"), []);
  const teams = createResource(() => api.get<Team[]>("/teams"), []);

  const slugs = $derived(buckets.data.map((b) => b.slug));

  /* Team access lives outside the draft's flat fields, so the form edits a
     set of slugs and the save sends it whole. */
  let picked = $state<string[]>([]);
  let issued = $state<BucketWithToken | null>(null);
  let rotating = $state<string | null>(null);
  /* A new token cuts off the pusher still holding the old one, so it takes a
     second click, as a delete does. */
  let armed = $state<string | null>(null);
  let copied = $state<string | null>(null);

  const ingestUrl = (slug: string) =>
    `${location.origin}${bucketIngestPath(slug)}`;
  const request = (slug: string, token: string) =>
    `POST ${ingestUrl(slug)}\nAuthorization: Bearer ${token}\nContent-Type: application/json`;

  const columns: Column<Bucket>[] = $derived([
    {
      key: "name",
      label: "bucket",
      width: "16rem",
      edit: "text",
      required: true,
    },
    {
      key: "slug",
      label: "id",
      formOnly: true,
      edit: "text",
      required: true,
      info: INFO.slug,
      derive: (d) => uniqueSlug(slugify(String(d.name ?? "")), slugs),
      editable: () => false,
    },
    {
      key: "description",
      label: "description",
      edit: "textarea",
      formOnly: true,
      info: "What the bucket holds, in a sentence. The agent reads it to decide whether a question belongs here.",
    },
    {
      key: "teams",
      label: t("teams"),
      value: (r) => r.teams.map((x) => x.name).join(", ") || "admins only",
    },
    { key: "docs", label: "docs", width: "6rem", align: "end" },
    {
      key: "pending_chunks",
      label: "to embed",
      width: "7rem",
      align: "end",
      value: (r) => r.pending_chunks || "",
    },
    { key: "source", label: "source", width: "9rem" },
    {
      key: "last_batch_at",
      label: "last batch",
      width: "11rem",
      cell: lastBatch,
    },
  ]);

  function openedForm(
    f: { mode: "create" | "edit"; row: Bucket | null } | null,
  ) {
    picked = f?.row ? f.row.teams.map((x) => x.slug) : [];
  }

  async function rotate(b: Bucket) {
    if (armed !== b.slug) {
      armed = b.slug;
      setTimeout(() => {
        if (armed === b.slug) armed = null;
      }, 4000);
      return;
    }
    armed = null;
    rotating = b.slug;
    try {
      issued = await api.post<BucketWithToken>(`/buckets/${b.slug}/token`, {});
      await buckets.reload();
    } finally {
      rotating = null;
    }
  }

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
      setTimeout(() => (copied = null), 1200);
    } catch {
      copied = null;
    }
  }

  onMount(() => Promise.all([buckets.reload(), teams.reload()]));
</script>

{#snippet lastBatch(r: Bucket)}
  <Time at={r.last_batch_at} />
{/snippet}

{#snippet teamPicker()}
  <div class="teams">
    <GroupHead label={`${t("teams")} that can read it`} />
    {#each teams.data as tm (tm.slug)}
      <label class="opt">
        <Checkbox
          checked={picked.includes(tm.slug)}
          ariaLabel={tm.name}
          onchange={(on) =>
            (picked = on
              ? [...picked, tm.slug]
              : picked.filter((s) => s !== tm.slug))}
        />
        <span>{tm.name}</span>
      </label>
    {:else}
      <Note>No {t("teams")} yet: only app admins will see this bucket.</Note>
    {/each}
  </div>
{/snippet}

{#snippet rotateAction(b: Bucket)}
  <Button
    variant="ghost"
    size="sm"
    icon={armed === b.slug ? "confirm" : "refresh"}
    busy={rotating === b.slug}
    onclick={() => rotate(b)}
    >{armed === b.slug ? "replace token?" : "new token"}</Button
  >
{/snippet}

<CrudTable
  hoist={sectionHoist("buckets")}
  {columns}
  rows={buckets.data}
  rowKey={(b) => b.slug}
  loading={buckets.loading}
  error={buckets.error ?? teams.error}
  emptyTitle="No buckets yet."
  addLabel="add bucket"
  noun="bucket"
  editTitle={(b) => b.name}
  formExtra={teamPicker}
  onform={openedForm}
  extraActions={rotateAction}
  oncreate={(d) =>
    buckets.mutate(async () => {
      issued = await api.post<BucketWithToken>("/buckets", {
        slug: d.slug,
        name: d.name,
        description: d.description || null,
        teams: picked,
      });
    })}
  onsave={(row, d) =>
    buckets.mutate(() =>
      api.patch(`/buckets/${row.slug}`, {
        name: d.name,
        description: d.description || null,
        teams: picked,
      }),
    )}
  ondelete={(row) => buckets.mutate(() => api.delete(`/buckets/${row.slug}`))}
/>

{#if issued}
  {@const b = issued.bucket}
  {@const tok = issued.token}
  <Modal
    title={`ingest token: ${b.name}`}
    confirmLabel="done"
    confirmIcon="confirm"
    width="44rem"
    onConfirm={() => (issued = null)}
    onCancel={() => (issued = null)}
  >
    <p class="line warn">
      <Icon name="alert" size="1em" />
      Copy it now. It won't be shown again.
    </p>
    <div class="secret">
      <code>{tok}</code>
      <Button
        variant="ghost"
        size="sm"
        icon={copied === "token" ? "confirm" : "copy"}
        title="copy the token"
        onclick={() => copy("token", tok)}
      />
    </div>
    <p class="line dim">
      <Icon name="token" size="1em" />
      Bearer token
    </p>
    <div class="secret">
      <pre>{request(b.slug, tok)}</pre>
      <Button
        variant="ghost"
        size="sm"
        icon={copied === "request" ? "confirm" : "copy"}
        title="copy the request"
        onclick={() => copy("request", request(b.slug, tok))}
      />
    </div>
  </Modal>
{/if}

<style>
  .teams {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    margin-top: var(--pad-2);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    cursor: pointer;
  }
  .secret {
    display: flex;
    align-items: flex-start;
    gap: var(--pad-2);
    margin: var(--pad-2) 0;
  }
  .secret code,
  .secret pre {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: var(--pad-2);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    border: 1px dashed var(--border);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .warn {
    color: var(--warn);
  }
  .dim {
    color: var(--muted);
  }
</style>
