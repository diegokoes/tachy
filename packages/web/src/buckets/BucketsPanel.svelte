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
  import { isGlobalAdmin } from "../access/session.svelte";

  const buckets = createResource(() => api.get<Bucket[]>("/buckets"), []);
  const teams = createResource(() => api.get<Team[]>("/teams"), []);

  const slugs = $derived(buckets.data.map((b) => b.slug));

  // Team access lives outside the draft's flat fields, so the form edits a set
  // of slugs and the save sends it whole.
  let picked = $state<string[]>([]);
  let issued = $state<BucketWithToken | null>(null);
  let rotating = $state<string | null>(null);
  // A new token cuts off the pusher still holding the old one, so it takes a
  // second click, as a delete does.
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
    form: { mode: "create" | "edit"; row: Bucket | null } | null,
  ) {
    picked = form?.row ? form.row.teams.map((x) => x.slug) : [];
  }

  async function rotate(bucket: Bucket) {
    if (armed !== bucket.slug) {
      armed = bucket.slug;
      setTimeout(() => {
        if (armed === bucket.slug) armed = null;
      }, 4000);
      return;
    }
    armed = null;
    rotating = bucket.slug;
    try {
      issued = await api.post<BucketWithToken>(
        `/buckets/${bucket.slug}/token`,
        {},
      );
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

{#snippet lastBatch(bucket: Bucket)}
  <Time at={bucket.last_batch_at} />
{/snippet}

{#snippet teamPicker()}
  <div class="teams">
    <GroupHead label={`${t("teams")} that can read it`} />
    {#each teams.data as team (team.slug)}
      <label class="opt">
        <Checkbox
          checked={picked.includes(team.slug)}
          ariaLabel={team.name}
          onchange={(on) =>
            (picked = on
              ? [...picked, team.slug]
              : picked.filter((s) => s !== team.slug))}
        />
        <span>{team.name}</span>
      </label>
    {:else}
      <Note>No {t("teams")} yet: only app admins will see this bucket.</Note>
    {/each}
  </div>
{/snippet}

{#snippet rotateAction(bucket: Bucket)}
  <Button
    variant="ghost"
    size="sm"
    icon={armed === bucket.slug ? "confirm" : "refresh"}
    busy={rotating === bucket.slug}
    onclick={() => rotate(bucket)}
    >{armed === bucket.slug ? "replace token?" : "new token"}</Button
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
  canEdit={isGlobalAdmin}
  canDelete={isGlobalAdmin}
  canCreate={isGlobalAdmin()}
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
  {@const bucket = issued.bucket}
  {@const token = issued.token}
  <Modal
    title={`ingest token: ${bucket.name}`}
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
      <code>{token}</code>
      <Button
        variant="ghost"
        size="sm"
        icon={copied === "token" ? "confirm" : "copy"}
        title="copy the token"
        onclick={() => copy("token", token)}
      />
    </div>
    <p class="line dim">
      <Icon name="token" size="1em" />
      Bearer token
    </p>
    <div class="secret">
      <pre>{request(bucket.slug, token)}</pre>
      <Button
        variant="ghost"
        size="sm"
        icon={copied === "request" ? "confirm" : "copy"}
        title="copy the request"
        onclick={() => copy("request", request(bucket.slug, token))}
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
