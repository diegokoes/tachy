/**
 * How a connection's items read to a model: the messages its rules leave out,
 * the payload fields it sends, and its groups' guidance. Kept in the
 * connection's config under `ingest`. Only what a model reads is shaped: the
 * stored copy keeps every message and field.
 */
import { z } from "zod";
import {
  INGEST_FIELD_MODES,
  evaluateCondition,
  readPath,
  type IngestConfig,
} from "@tachy/contract";
import { getCustomerSlug } from "../catalog/customers";
import {
  redactForLlm,
  resolveRedactionPolicy,
  type RedactionPolicy,
} from "../compliance/redaction";
import { sql, jsonb } from "../infra/db";
import { notFound } from "../infra/errors";
import { log } from "../infra/log";
import type { ResolvedSource } from "../sources/registry";
import { isTachyNote } from "../work-items/compact";
import { messageKey } from "../work-items/ingest";
import type { RawMessage, RawWorkItem } from "../work-items/raw";
import { conditionSchema, flowId } from "./schemas";
import { tagsOf } from "./subject";

/** Where a connection keeps its ingest config inside `config`. */
const KEY = "ingest";
const GUIDANCE_MAX_CHARS = 4000;

export const ingestRuleSchema = z
  .object({
    id: flowId,
    label: z.string().trim().max(80),
    enabled: z.boolean().default(true),
    where: conditionSchema,
  })
  .strict();

const fieldsSchema = z
  .object({
    mode: z.enum(INGEST_FIELD_MODES),
    paths: z.array(z.string().trim().min(1)).max(500),
  })
  .strict();

const guidanceSchema = z.record(z.string(), z.string().max(GUIDANCE_MAX_CHARS));

export const ingestConfigSchema = z
  .object({
    skip: z.array(ingestRuleSchema).max(100).optional(),
    fields: fieldsSchema.optional(),
    guidance: guidanceSchema.optional(),
  })
  .strict();

/**
 * A connection's ingest config. A part that no longer parses is dropped on
 * its own, so a read never fails on a saved rule.
 */
export function ingestConfig(
  connConfig: Record<string, unknown> | null | undefined,
): IngestConfig {
  const saved = connConfig?.[KEY];
  if (saved == null || typeof saved !== "object") return {};
  const whole = ingestConfigSchema.safeParse(saved);
  if (whole.success) return whole.data;
  log("warn", "ingest_config_invalid", {
    issues: whole.error.issues.map((issue) => issue.path.join(".")),
  });
  const parts = saved as Record<string, unknown>;
  const skip = Array.isArray(parts.skip)
    ? parts.skip.flatMap((rule) => {
        const parsed = ingestRuleSchema.safeParse(rule);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const fields = fieldsSchema.safeParse(parts.fields);
  const guidance = guidanceSchema.safeParse(parts.guidance);
  return {
    ...(skip.length ? { skip } : {}),
    ...(fields.success ? { fields: fields.data } : {}),
    ...(guidance.success ? { guidance: guidance.data } : {}),
  };
}

export async function getIngestConfig(
  connectionSlug: string,
): Promise<IngestConfig> {
  const [row] = await sql<{ config: Record<string, unknown> | null }[]>`
    select config from source_connections where slug = ${connectionSlug}
  `;
  if (!row) throw notFound(`Source connection '${connectionSlug}' not found`);
  return ingestConfig(row.config);
}

/** Replaces the whole ingest config; the rest of the connection's config is kept. */
export async function setIngestConfig(
  connectionSlug: string,
  config: IngestConfig,
): Promise<IngestConfig> {
  const [row] = await sql`
    update source_connections
    set config = jsonb_set(coalesce(config, '{}'::jsonb), ${[KEY]}::text[], ${jsonb(config)})
    where slug = ${connectionSlug}
    returning config -> ${KEY} as ingest
  `;
  if (!row) throw notFound(`Source connection '${connectionSlug}' not found`);
  return row.ingest as IngestConfig;
}

/** A message as a skip rule reads it, under `message`. */
function messageSubject(message: RawMessage) {
  return {
    author: message.author ?? null,
    author_label: message.authorLabel ?? null,
    visibility: message.visibility,
    direction: message.direction,
    automated: message.automated === true,
    body: message.bodyText,
    chars: message.bodyText.length,
  };
}

/** The item as a skip rule reads it, under `item`: what the read itself carries. */
function itemSubject(item: RawWorkItem) {
  const raw = (item.raw ?? {}) as Record<string, unknown>;
  return {
    title: item.title ?? null,
    status: item.status ?? null,
    group: item.groupKey ?? null,
    kind: item.kind,
    requester: item.requester ?? null,
    tags: tagsOf(raw),
    raw,
  };
}

function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.split(".");
  let at = target;
  for (const key of keys.slice(0, -1)) {
    const next = at[key];
    at[key] = next && typeof next === "object" ? next : {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = value;
}

function deletePath(target: Record<string, unknown>, path: string) {
  const keys = path.split(".");
  const parent = readPath(target, keys.slice(0, -1).join("."));
  if (parent && typeof parent === "object")
    delete (parent as Record<string, unknown>)[keys[keys.length - 1]];
}

/** `omits` goes in every case: the paths the messages already carry. */
function shapePayload(
  payload: unknown,
  fields: IngestConfig["fields"],
  omits: readonly string[],
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return payload;
  if (!fields && !omits.length) return payload;
  if (fields?.mode === "only") {
    const picked: Record<string, unknown> = {};
    for (const path of fields.paths) {
      if (omits.includes(path)) continue;
      const value = readPath(payload, path);
      if (value !== undefined) setPath(picked, path, structuredClone(value));
    }
    return picked;
  }
  const kept = structuredClone(payload) as Record<string, unknown>;
  for (const path of [...(fields?.paths ?? []), ...omits])
    deletePath(kept, path);
  return kept;
}

export interface IngestOutcome {
  /** What tachy reads facts and links from: a model's messages, the payload whole. */
  kept: RawWorkItem;
  /** What a model reads: `kept` with its payload shaped. */
  item: RawWorkItem;
  /** Each left-out message's stored key, with the rule that left it out. */
  skipped: { key: string; rule: string }[];
  guidance?: string;
}

/**
 * Pure. A note tachy wrote is never left out: the next run finds it among
 * the messages to replace it.
 */
export function applyIngest(
  raw: RawWorkItem,
  config: IngestConfig,
  omits: readonly string[] = [],
): IngestOutcome {
  const rules = (config.skip ?? []).filter((rule) => rule.enabled);
  const skipped: IngestOutcome["skipped"] = [];
  let messages = raw.messages;
  if (rules.length) {
    const item = itemSubject(raw);
    messages = raw.messages.filter((message) => {
      if (isTachyNote(message.bodyText)) return true;
      const subject = { message: messageSubject(message), item };
      const rule = rules.find((r) => evaluateCondition(r.where, subject));
      if (!rule) return true;
      skipped.push({ key: messageKey(message), rule: rule.id });
      return false;
    });
  }
  const kept = { ...raw, messages };
  const guidance = raw.groupKey
    ? config.guidance?.[raw.groupKey]?.trim()
    : undefined;
  return {
    kept,
    item: { ...kept, raw: shapePayload(raw.raw, config.fields, omits) },
    skipped,
    ...(guidance ? { guidance } : {}),
  };
}

export interface ModelRead extends IngestOutcome {
  /** `item` went through redaction. */
  redacted: boolean;
}

/**
 * What a model reads of an item just fetched: the connection's ingest rules,
 * then its redaction. `policy` is for a process that reads the global switch
 * from the settings rather than its environment.
 */
export async function readForModel(
  resolved: ResolvedSource,
  raw: RawWorkItem,
  opts: { customerId: string | null; policy?: RedactionPolicy },
): Promise<ModelRead> {
  const outcome = applyIngest(
    raw,
    ingestConfig(resolved.conn.config),
    resolved.source.modelOmits,
  );
  const policy = opts.policy ?? resolveRedactionPolicy(resolved.conn.config);
  if (!policy.enabled) return { ...outcome, redacted: false };
  return {
    ...outcome,
    item: redactForLlm(
      outcome.item,
      resolved.source.redactRaw,
      await getCustomerSlug(opts.customerId),
    ),
    redacted: true,
  };
}
