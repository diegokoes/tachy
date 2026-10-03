import type {
  WorkItemTypeOption,
  ComposerForm,
  ComposerProject,
  CreatedTicket,
  PrefillOrigin,
  TicketContextItem,
  TicketDraft,
  TicketReview,
  TicketValidation,
} from "@tachy/contract";
import { api, ApiError } from "../api";
import { ensureProjects, ensureTypes } from "./az.svelte";
import { onUnauthorized } from "../access/session.svelte";
import { isBody, isEmpty, TAGS, TITLE } from "./layout";
import { toHtml } from "./ticketMarkdown";

export interface PastedImage {
  key: string;
  name: string;
  file: File;
  /** An object URL, for the preview only. */
  url: string;
}

export interface ContextItem extends TicketContextItem {
  /** The tachy work item it was ingested as, for the tracked_by link. */
  work_item_id: string | null;
  source_type: string | null;
}

const STORE = "tachy.az.draft";

const blank = () => ({
  title: "",
  /** By reference name. HTML fields hold markdown until they are sent. */
  values: {} as Record<string, unknown>,
  /** Values the form put there and the person has not touched since. */
  origins: {} as Record<string, PrefillOrigin>,
  context: [] as ContextItem[],
  /** Tachy work items a draft handed over by the agent was raised from. */
  raisedFrom: [] as string[],
});

export const composer = $state({
  open: false,
  project: null as ComposerProject | null,
  type: null as WorkItemTypeOption | null,
  form: null as ComposerForm | null,
  loading: false,
  error: null as string | null,
  ...blank(),
  images: [] as PastedImage[],
  validation: null as TicketValidation | null,
  checking: false,
  review: null as TicketReview | null,
  /** The findings of the review before this one, to show which got fixed. */
  previous: null as TicketReview | null,
  reviewing: false,
  dismissed: [] as string[],
  creating: false,
});

/** Anything a person would be sorry to lose by closing the window. */
export const hasDraft = () =>
  !!composer.title.trim() ||
  composer.context.length > 0 ||
  composer.images.length > 0 ||
  Object.keys(composer.values).some(
    (k) => !composer.origins[k] && !isEmpty(composer.values[k]),
  );

function persist() {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        project: composer.project,
        type: composer.type,
        title: composer.title,
        values: composer.values,
        origins: composer.origins,
        context: composer.context,
        raisedFrom: composer.raisedFrom,
      }),
    );
  } catch {
    /* storage blocked or full: the draft lives for this tab only */
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(composer, {
      project: d.project ?? null,
      type: d.type ?? null,
      title: d.title ?? "",
      values: d.values ?? {},
      origins: d.origins ?? {},
      context: d.context ?? [],
      raisedFrom: d.raisedFrom ?? [],
    });
  } catch {
    /* a draft from an older shape is not worth an error */
  }
}
restore();

/** Called by the view on every change; cheap enough not to debounce. */
export const saveDraft = persist;

export async function openComposer(
  project?: ComposerProject | null,
  type?: WorkItemTypeOption | null,
) {
  composer.open = true;
  if (project && project.id !== composer.project?.id) setProject(project);
  if (type && type.name !== composer.type?.name) await setType(type);
  else if (composer.type && !composer.form) await loadForm();
}

export function closeComposer() {
  composer.open = false;
  persist();
}

export function discardDraft() {
  for (const img of composer.images) URL.revokeObjectURL(img.url);
  Object.assign(composer, blank(), {
    images: [],
    form: null,
    type: null,
    validation: null,
    review: null,
    previous: null,
    dismissed: [],
    error: null,
  });
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* nothing stored */
  }
}

export function setProject(project: ComposerProject) {
  composer.project = project;
  composer.type = null;
  composer.form = null;
  dropPrefills();
}

/** What the person typed survives a type change; only prefills are redone. */
export async function setType(type: WorkItemTypeOption) {
  composer.type = type;
  await loadForm();
}

function dropPrefills() {
  for (const ref of Object.keys(composer.origins)) delete composer.values[ref];
  composer.origins = {};
}

export async function loadForm() {
  if (!composer.project || !composer.type) return;
  composer.loading = true;
  composer.error = null;
  composer.validation = null;
  try {
    const form = await api.get<ComposerForm>(
      `/compose/projects/${composer.project.id}/form?type=${encodeURIComponent(composer.type.name)}`,
    );
    dropPrefills();
    for (const [ref, { value, origin }] of Object.entries(form.prefill))
      if (isEmpty(composer.values[ref])) {
        composer.values[ref] = value;
        composer.origins[ref] = origin;
      }
    composer.form = form;
  } catch (e) {
    composer.error = e instanceof Error ? e.message : String(e);
  } finally {
    composer.loading = false;
  }
}

export function setValue(ref: string, value: unknown) {
  composer.values[ref] = value;
  delete composer.origins[ref];
  composer.validation = null;
}

export async function applyTemplate(id: string) {
  const { project, form } = composer;
  if (!project || !form?.team) return;
  const values = await api.get<Record<string, unknown>>(
    `/compose/projects/${project.id}/templates/${encodeURIComponent(id)}?team=${encodeURIComponent(form.team)}`,
  );
  for (const [ref, value] of Object.entries(values)) {
    if (ref === TITLE) {
      if (!composer.title.trim()) composer.title = String(value);
      continue;
    }
    if (composer.origins[ref] || isEmpty(composer.values[ref])) {
      composer.values[ref] = value;
      composer.origins[ref] = "template";
    }
  }
}

function fieldsOut(): Record<string, unknown> {
  const specs = new Map(
    (composer.form?.fields ?? []).map((f) => [f.reference_name, f]),
  );
  const out: Record<string, unknown> = {};
  for (const [ref, v] of Object.entries(composer.values)) {
    if (isEmpty(v) || ref === TITLE) continue;
    const spec = specs.get(ref);
    if (!spec) continue;
    out[ref] = isBody(spec) ? toHtml(String(v)) : v;
  }
  return out;
}

export function draft(): TicketDraft {
  const tags = String(composer.values[TAGS] ?? "")
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const fields = fieldsOut();
  delete fields[TAGS];
  const workItemIds = [
    ...new Set([
      ...composer.raisedFrom,
      ...composer.context
        .map((c) => c.work_item_id)
        .filter((id): id is string => !!id),
    ]),
  ];
  return {
    type: composer.type!.name,
    title: composer.title.trim(),
    fields,
    ...(tags.length ? { tags } : {}),
    ...(workItemIds.length ? { work_item_ids: workItemIds } : {}),
  };
}

export async function validate() {
  if (!composer.project || !composer.type) return;
  composer.checking = true;
  try {
    composer.validation = await api.post<TicketValidation>(
      `/compose/projects/${composer.project.id}/validate`,
      draft(),
    );
  } catch (e) {
    composer.validation = {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    composer.checking = false;
  }
}

/** Multipart, so it bypasses the JSON client: the images ride along. */
export async function create(): Promise<CreatedTicket | null> {
  if (!composer.project || !composer.type) return null;
  composer.creating = true;
  composer.error = null;
  try {
    const body = new FormData();
    body.set("draft", JSON.stringify(draft()));
    for (const img of composer.images)
      body.set(`image:${img.key}`, img.file, img.name);
    const res = await fetch(`/api/compose/projects/${composer.project.id}/items`, {
      method: "POST",
      body,
    });
    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError(401, "unauthorized");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json?.error ?? res.statusText);
    const created = json as CreatedTicket;
    discardDraft();
    composer.open = false;
    return created;
  } catch (e) {
    composer.error = e instanceof Error ? e.message : String(e);
    return null;
  } finally {
    composer.creating = false;
  }
}

/** What the reviewer reads: markdown as typed, not the HTML ADO is sent. */
function reviewFields(): { ref: string; name: string; value: string }[] {
  return (composer.form?.fields ?? [])
    .filter(
      (f) =>
        f.reference_name !== TITLE &&
        !isEmpty(composer.values[f.reference_name]),
    )
    .map((f) => ({
      ref: f.reference_name,
      name: composer.form?.labels[f.reference_name] ?? f.name,
      value: String(composer.values[f.reference_name]),
    }));
}

export async function askReview() {
  if (!composer.type) return;
  composer.reviewing = true;
  try {
    const review = await api.post<TicketReview>("/compose/review", {
      project_id: composer.project?.id,
      type: composer.type.name,
      title: composer.title,
      fields: reviewFields(),
      images: composer.images.length,
      context: composer.context.map(({ source, external_id, title, text }) => ({
        source,
        external_id,
        title,
        text,
      })),
    });
    composer.previous = composer.review;
    composer.review = review;
    composer.dismissed = [];
  } catch (e) {
    composer.error = e instanceof Error ? e.message : String(e);
  } finally {
    composer.reviewing = false;
  }
}

/**
 * The agent's create_ado_work_item call, moved into the composer for the person
 * to finish. False when its project is not one of the caller's team's.
 */
export async function adoptAgentDraft(
  input: Record<string, unknown>,
): Promise<boolean> {
  const str = (k: string) =>
    typeof input[k] === "string" ? (input[k] as string) : undefined;
  const projects = await ensureProjects();
  const project = projects.find(
    (p) =>
      (str("project") &&
        p.external_key === str("project") &&
        (!str("source") || p.source_slug === str("source"))) ||
      (!str("project") &&
        str("product_slug") &&
        p.product_slug === str("product_slug")),
  );
  if (!project) return false;
  const types = await ensureTypes(project.id);
  const type = types.find(
    (t) => t.name.toLowerCase() === (str("type") ?? "").toLowerCase(),
  );

  discardDraft();
  setProject(project);
  composer.title = str("title") ?? "";
  const fields =
    input.fields && typeof input.fields === "object"
      ? (input.fields as Record<string, unknown>)
      : {};
  for (const [ref, v] of Object.entries(fields)) composer.values[ref] = v;
  if (str("description"))
    composer.values["System.Description"] = str("description");
  if (Array.isArray(input.tags)) composer.values[TAGS] = input.tags.join("; ");
  if (str("work_item_id")) composer.raisedFrom = [str("work_item_id")!];
  composer.open = true;
  if (type) await setType(type);
  return true;
}
