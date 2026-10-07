import type { FlowOption } from "@tachy/contract";
import {
  customerStandIn,
  resolveRedactionPolicy,
  scrubDeep,
  TokenMap,
} from "../compliance/redaction";
import type { ScopeContext } from "../config/scoped";
import { effectiveSettings } from "../config/settings";
import { sql } from "../infra/db";
import { resolveSource } from "../sources/registry";
import type { FlowSubject } from "./subject";

/**
 * A property's key as later steps name it, `{{steps.<id>.values.<key>}}`:
 * a fact by its kind and label, a field of the source's record of the
 * customer behind `company-`. No dots, since a dot is a step into the value.
 */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-|-$/g, "");

export const factKey = (kind: string, label: string) =>
  label ? `${slug(kind)}-${slug(label)}` : slug(kind);

export const companyKey = (field: string) => `company-${slug(field)}`;

/**
 * Every property a customer can have: the facts in use, then the source's
 * customer fields.
 */
export async function customerPropertyOptions(
  connection: string | undefined,
  scope: ScopeContext,
): Promise<FlowOption[]> {
  const facts = await sql<{ kind: string; label: string; n: number }[]>`
    select kind, label, count(*)::int as n from customer_facts
    where unit_id is null
    group by kind, label order by kind, label
  `;
  const own = facts.map((f) => ({
    value: factKey(f.kind, f.label),
    label: f.label ? `${f.kind} · ${f.label}` : f.kind,
    hint: `fact, ${f.n} ${f.n === 1 ? "customer" : "customers"}`,
  }));
  if (!connection) return own;
  const { conn, source } = await resolveSource(connection, scope);
  // The facts are worth offering even when the source cannot be reached.
  const fields = source.options
    ? await source.options("company_fields", {}).catch(() => [])
    : [];
  return [
    ...own,
    ...fields.map((f) => ({
      value: companyKey(f.value),
      label: f.label,
      hint: `${conn.sourceType} company`,
    })),
  ];
}

const asText = (v: unknown): string | null =>
  v == null || v === ""
    ? null
    : Array.isArray(v)
      ? v.map(String).join(", ")
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);

/**
 * The asked-for properties of an item's customer, null where it has none.
 * Redacted like anything else the model may read when the item's connection
 * or the deployment says so, with the source's name for the customer
 * replaced by tachy's slug.
 */
export async function customerProperties(
  item: FlowSubject,
  keys: string[],
  scope: ScopeContext,
): Promise<{
  found: boolean;
  customer: string | null;
  values: Record<string, string | null>;
}> {
  const values: Record<string, string | null> = Object.fromEntries(
    keys.map((k) => [k, null]),
  );
  const wanted = new Set(keys);
  if (item.customer_id) {
    const facts = await sql<{ kind: string; label: string; value: string }[]>`
      select kind, label, value from customer_facts
      where customer_id = ${item.customer_id} and unit_id is null
    `;
    for (const f of facts) {
      const k = factKey(f.kind, f.label);
      if (wanted.has(k)) values[k] = f.value;
    }
  }

  let record: Record<string, unknown> | null = null;
  if (keys.some((k) => k.startsWith("company-"))) {
    const { source } = await resolveSource(item.connection, scope);
    record = (await source.customerRecord?.(item.raw)) ?? null;
    for (const [field, v] of Object.entries(record ?? {})) {
      const k = companyKey(field);
      if (wanted.has(k)) values[k] = asText(v);
    }
  }

  const [conn] = await sql<{ config: Record<string, unknown> | null }[]>`
    select config from source_connections where slug = ${item.connection}
  `;
  const redact =
    (await effectiveSettings()).redaction_global.value ||
    resolveRedactionPolicy(conn?.config).enabled;
  const name = asText(record?.name);
  const out = redact
    ? Object.fromEntries(
        Object.entries(scrubDeep(values, new TokenMap())).map(([k, v]) => [
          k,
          name && v ? v.replaceAll(name, customerStandIn(item.customer)) : v,
        ]),
      )
    : values;
  return {
    found: !!item.customer_id || !!record,
    customer: item.customer,
    values: out,
  };
}
