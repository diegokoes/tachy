import type { AdoFieldType, FieldSpec, WorkItemSchema } from "@tachy/core";
import type { AdoClient, AdoField, AdoTypeField } from "./client";

export type { AdoFieldType, FieldSpec, WorkItemSchema };

/**
 * Azure DevOps splits what a form needs across two endpoints, and neither is
 * sufficient alone:
 *
 *   workitemtypes/{type}/fields?$expand=all  what the type REQUIRES and ALLOWS
 *                                            (alwaysRequired, allowedValues,
 *                                            defaultValue, helpText) — but
 *                                            carries no data type at all
 *   _apis/wit/fields                         the account-wide definitions, which
 *                                            DO carry type / readOnly / isIdentity
 *
 * Joining them on referenceName is the only way to know both that a field is
 * required and what kind of control it deserves. Verified against the 7.1 REST
 * reference: `WorkItemTypeFieldWithReferences` is exactly {allowedValues,
 * alwaysRequired, defaultValue, dependentFields, helpText, name, referenceName,
 * url}.
 */
export const MAX_ALLOWED_VALUES = 50;

/**
 * The projection both the MCP tool and the HTTP route return. One function so
 * they cannot drift: a field the browser renders and a field the agent is told
 * about have to be the same field.
 */
export function projectFields(
  typeFields: AdoTypeField[],
  accountFields: AdoField[] = [],
): FieldSpec[] {
  const byRef = new Map<string, AdoField>();
  for (const f of accountFields)
    if (f?.referenceName) byRef.set(f.referenceName, f);

  return typeFields.map((f) => {
    const values = Array.isArray(f.allowedValues) ? f.allowedValues : [];
    const account = byRef.get(f.referenceName);
    return {
      reference_name: f.referenceName,
      name: f.name,
      required: f.alwaysRequired === true,
      ...(values.length
        ? {
            allowed_values: values.slice(0, MAX_ALLOWED_VALUES),
            ...(values.length > MAX_ALLOWED_VALUES
              ? { allowed_values_truncated: true as const }
              : {}),
          }
        : {}),
      ...(f.defaultValue != null ? { default_value: f.defaultValue } : {}),
      ...(account?.type ? { type: account.type as AdoFieldType } : {}),
      ...(account?.readOnly === true ? { read_only: true as const } : {}),
      ...(account?.isIdentity === true ? { is_identity: true as const } : {}),
      ...(f.helpText ? { help_text: f.helpText } : {}),
    };
  });
}

/**
 * Fetch and join. The account-wide list is org-scoped and unchanging between
 * calls, so a failure to read it degrades the result rather than failing it —
 * required fields and allowed values still arrive, only the typed widgets do
 * not.
 */
export async function workItemSchema(
  client: AdoClient,
  project: string,
  type: string,
  configDefaults: Record<string, unknown> = {},
): Promise<WorkItemSchema> {
  const [typeFields, accountFields] = await Promise.all([
    client.getTypeFields(project, type),
    client.listFields().catch(() => [] as AdoField[]),
  ]);
  return {
    project,
    type,
    fields: projectFields(typeFields, accountFields),
    config_defaults: configDefaults,
  };
}

const dig = (v: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>(
    (at, k) =>
      at && typeof at === "object"
        ? (at as Record<string, unknown>)[k]
        : undefined,
    v,
  );

/**
 * Field values a new work item of `type` starts from: the registered project's
 * `defaults[type]` when it has one, else the connection's
 * `defaults[project][type]`.
 */
export function workItemDefaults(
  connectionConfig: unknown,
  project: string,
  type: string,
  projectConfig?: unknown,
): Record<string, unknown> {
  return (dig(projectConfig, "defaults", type) ??
    dig(connectionConfig, "defaults", project, type) ??
    {}) as Record<string, unknown>;
}
