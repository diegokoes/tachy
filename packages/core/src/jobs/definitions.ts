import { Cron } from "croner";
import {
  JOB_NOTIFY,
  JOB_OVERLAP,
  JOB_RESOURCE_CLASSES,
  parseDuration,
} from "@tachy/contract";
import { z } from "zod";
import { sql, type Db } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { getJobKind, hasJobKind } from "./registry";

export interface JobDefinition {
  id: string;
  kind: string;
  name: string;
  params: Record<string, unknown>;
  enabled: boolean;
  schedule: string | null;
  timezone: string;
  resource_class: (typeof JOB_RESOURCE_CLASSES)[number] | null;
  timeout: string | null;
  overlap: (typeof JOB_OVERLAP)[number] | null;
  notify: (typeof JOB_NOTIFY)[number];
  last_scheduled_for: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export const jobDefinitionInput = z.object({
  kind: z.string().min(1),
  name: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
  schedule: z.string().nullable().default(null),
  timezone: z.string().default("UTC"),
  resource_class: z.enum(JOB_RESOURCE_CLASSES).nullable().default(null),
  timeout: z.string().nullable().default(null),
  overlap: z.enum(JOB_OVERLAP).nullable().default(null),
  notify: z.enum(JOB_NOTIFY).default("failure"),
});
export type JobDefinitionInput = z.input<typeof jobDefinitionInput>;

/** Every check a save must pass, so a bad definition never reaches a worker. */
export function validateDefinition(input: z.output<typeof jobDefinitionInput>) {
  if (!hasJobKind(input.kind))
    throw badInput(`unknown job kind '${input.kind}'`);
  const kind = getJobKind(input.kind);
  const parsed = kind.params.safeParse(input.params);
  if (!parsed.success)
    throw badInput(
      `params for ${input.kind}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`,
    );
  if (input.schedule) {
    try {
      new Cron(input.schedule, { timezone: input.timezone }).nextRun();
    } catch (err) {
      throw badInput(`schedule '${input.schedule}': ${String(err)}`);
    }
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    throw badInput(`unknown timezone '${input.timezone}'`);
  }
  if (input.timeout) {
    try {
      parseDuration(input.timeout);
    } catch (err) {
      throw badInput(String((err as Error).message));
    }
  }
  return { ...input, params: parsed.data as Record<string, unknown> };
}

/** The next few fire times, for the form's preview. */
export function previewSchedule(
  schedule: string,
  timezone = "UTC",
  count = 5,
): string[] {
  return new Cron(schedule, { timezone })
    .nextRuns(count)
    .map((d) => d.toISOString());
}

const COLUMNS = sql`id, kind, name, params, enabled, schedule, timezone, resource_class,
  timeout, overlap, notify, last_scheduled_for, disabled_reason, created_at, updated_at`;

export async function listJobDefinitions(): Promise<JobDefinition[]> {
  return (await sql`select ${COLUMNS} from job_definitions order by name`) as never;
}

export async function getJobDefinition(
  id: string,
  db: Db = sql,
): Promise<JobDefinition> {
  const [row] =
    await db`select ${COLUMNS} from job_definitions where id = ${id}`;
  if (!row) throw notFound(`job definition ${id} not found`);
  return row as never;
}

async function recordChange(
  db: Db,
  definitionId: string,
  by: string | null,
  action: "created" | "updated" | "deleted" | "disabled",
  oldValue: unknown,
  newValue: unknown,
) {
  await db`
    insert into job_definition_changes (definition_id, changed_by, action, old_value, new_value)
    values (${definitionId}, ${by}, ${action},
            ${oldValue === null ? null : sql.json(oldValue as never)},
            ${newValue === null ? null : sql.json(newValue as never)})
  `;
}

export async function createJobDefinition(
  input: JobDefinitionInput,
  by: string | null,
): Promise<JobDefinition> {
  const d = validateDefinition(jobDefinitionInput.parse(input));
  return sql.begin(async (tx) => {
    const [row] = await tx`
      insert into job_definitions (kind, name, params, enabled, schedule, timezone,
        resource_class, timeout, overlap, notify, created_by, updated_by, last_scheduled_for)
      values (${d.kind}, ${d.name}, ${sql.json(d.params as never)}, ${d.enabled}, ${d.schedule},
        ${d.timezone}, ${d.resource_class}, ${d.timeout}, ${d.overlap}, ${d.notify}, ${by}, ${by}, now())
      on conflict (name) do nothing
      returning ${COLUMNS}
    `;
    if (!row)
      throw badInput(`a job definition named '${d.name}' already exists`);
    await recordChange(tx, row.id, by, "created", null, d);
    return row as never;
  }) as Promise<JobDefinition>;
}

export async function updateJobDefinition(
  id: string,
  patch: Partial<JobDefinitionInput>,
  by: string | null,
): Promise<JobDefinition> {
  return sql.begin(async (tx) => {
    const current = await getJobDefinition(id, tx);
    const {
      id: _id,
      last_scheduled_for,
      disabled_reason,
      created_at,
      updated_at,
      ...editable
    } = current;
    const merged = validateDefinition(
      jobDefinitionInput.parse({ ...editable, ...patch }),
    );
    const scheduleChanged =
      merged.schedule !== current.schedule ||
      merged.timezone !== current.timezone;
    const [row] = await tx`
      update job_definitions set
        kind = ${merged.kind}, name = ${merged.name}, params = ${sql.json(merged.params as never)},
        enabled = ${merged.enabled}, schedule = ${merged.schedule}, timezone = ${merged.timezone},
        resource_class = ${merged.resource_class}, timeout = ${merged.timeout},
        overlap = ${merged.overlap}, notify = ${merged.notify},
        disabled_reason = ${merged.enabled ? null : disabled_reason},
        last_scheduled_for = ${scheduleChanged ? sql`now()` : sql`last_scheduled_for`},
        updated_by = ${by}, updated_at = now()
      where id = ${id}
      returning ${COLUMNS}
    `;
    await recordChange(tx, id, by, "updated", editable, merged);
    return row as never;
  }) as Promise<JobDefinition>;
}

export async function deleteJobDefinition(
  id: string,
  by: string | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    const current = await getJobDefinition(id, tx);
    await recordChange(tx, id, by, "deleted", current, null);
    await tx`delete from job_definitions where id = ${id}`;
  });
}

export async function listJobDefinitionChanges(id: string) {
  return sql`
    select c.id, c.action, c.old_value, c.new_value, c.created_at, u.email as changed_by
    from job_definition_changes c left join users u on u.id = c.changed_by
    where c.definition_id = ${id}
    order by c.created_at desc
    limit 100
  `;
}

/**
 * A release can change a kind's params. Stored definitions that no longer
 * validate are disabled with the reason shown, instead of crashing a worker.
 */
export async function disableInvalidDefinitions(): Promise<string[]> {
  const disabled: string[] = [];
  for (const d of await listJobDefinitions()) {
    if (!d.enabled) continue;
    let reason: string | null = null;
    if (!hasJobKind(d.kind)) reason = `kind '${d.kind}' no longer exists`;
    else {
      const parsed = getJobKind(d.kind).params.safeParse(d.params);
      if (!parsed.success)
        reason = `params no longer valid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`;
    }
    if (!reason) continue;
    await sql.begin(async (tx) => {
      await tx`update job_definitions set enabled = false, disabled_reason = ${reason} where id = ${d.id}`;
      await recordChange(
        tx,
        d.id,
        null,
        "disabled",
        { enabled: true },
        { enabled: false, reason },
      );
    });
    disabled.push(d.name);
  }
  return disabled;
}
