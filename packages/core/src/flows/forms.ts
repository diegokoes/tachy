import type {
  ComposeConfig,
  ComposerForm,
  TypeFormConfig,
  WorkItemTypeOption,
} from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import { notFound } from "../infra/errors";

/** Where a registered project keeps its compose config inside `config`. */
const KEY = "compose";

export async function getComposeConfig(
  sourceProjectId: string,
): Promise<ComposeConfig> {
  const [row] = await sql`
    select config -> ${KEY} as compose from source_projects where id = ${sourceProjectId}
  `;
  if (!row) throw notFound(`Source project '${sourceProjectId}' not found`);
  return (row.compose ?? {}) as ComposeConfig;
}

/** Replaces the whole compose config; the rest of the project's config is kept. */
export async function setComposeConfig(
  sourceProjectId: string,
  config: ComposeConfig,
): Promise<ComposeConfig> {
  const [row] = await sql`
    update source_projects
    set config = jsonb_set(config, ${[KEY]}::text[], ${jsonb(config)})
    where id = ${sourceProjectId}
    returning config -> ${KEY} as compose
  `;
  if (!row) throw notFound(`Source project '${sourceProjectId}' not found`);
  return row.compose as ComposeConfig;
}

/** The types the team offers, in its order; every type when it chose none. */
export function offeredTypes(
  all: WorkItemTypeOption[],
  config: ComposeConfig,
): WorkItemTypeOption[] {
  if (!config.types?.length) return all;
  const byName = new Map(all.map((t) => [t.name, t]));
  return config.types.flatMap((n) => byName.get(n) ?? []);
}

export const typeConfig = (
  config: ComposeConfig,
  type: string,
): TypeFormConfig | undefined => config.forms?.[type];

/**
 * The team's config laid over the source's form: its defaults become prefills
 * the person can still change, above the source's and below a template's, and
 * its show/order choices travel as `display` for the composer to draw. A
 * default for a field the type no longer has is dropped rather than sent.
 */
export function applyFormConfig(
  form: ComposerForm,
  typeConfig: TypeFormConfig | undefined,
): ComposerForm {
  if (!typeConfig) return form;
  const known = new Set(form.fields.map((f) => f.reference_name));
  const prefill = { ...form.prefill };
  const show: NonNullable<ComposerForm["display"]>["show"] = {};
  for (const [ref, fieldConfig] of Object.entries(typeConfig.fields ?? {})) {
    if (!known.has(ref)) continue;
    if (fieldConfig.show) show[ref] = fieldConfig.show;
    const fieldDefault = fieldConfig.default;
    if (!fieldDefault) continue;
    const value =
      "macro" in fieldDefault ? form.me?.unique_name : fieldDefault.value;
    if (value != null && value !== "")
      prefill[ref] = { value, origin: "admin" };
  }
  return {
    ...form,
    prefill,
    display: {
      show,
      order: (typeConfig.order ?? []).filter((r) => known.has(r)),
    },
  };
}
