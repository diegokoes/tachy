/**
 * Azure DevOps splits what a form needs across two endpoints:
 *
 *   workitemtypes/{type}/fields?$expand=all  what the type requires and allows
 *     (alwaysRequired, allowedValues, defaultValue, helpText), with no data type
 *   _apis/wit/fields  the account-wide definitions, which carry type, readOnly
 *     and isIdentity
 *
 * Joining them on referenceName gives both that a field is required and what
 * control it takes. Per the 7.1 REST reference,
 * `WorkItemTypeFieldWithReferences` is {allowedValues, alwaysRequired,
 * defaultValue, dependentFields, helpText, name, referenceName, url}.
 */
import type { AdoFieldType, FieldSpec, WorkItemSchema } from "@tachy/core";
import type { AdoClient, AdoField, AdoTypeField } from "./client";

export type { AdoFieldType, FieldSpec, WorkItemSchema };

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
  for (const field of accountFields)
    if (field?.referenceName) byRef.set(field.referenceName, field);

  return typeFields.map((field) => {
    const values = Array.isArray(field.allowedValues)
      ? field.allowedValues
      : [];
    const account = byRef.get(field.referenceName);
    return {
      reference_name: field.referenceName,
      name: field.name,
      required: field.alwaysRequired === true,
      ...(values.length
        ? {
            allowed_values: values.slice(0, MAX_ALLOWED_VALUES),
            ...(values.length > MAX_ALLOWED_VALUES
              ? { allowed_values_truncated: true as const }
              : {}),
          }
        : {}),
      ...(field.defaultValue != null
        ? { default_value: field.defaultValue }
        : {}),
      ...(account?.type ? { type: account.type as AdoFieldType } : {}),
      ...(account?.readOnly === true ? { read_only: true as const } : {}),
      ...(account?.isIdentity === true ? { is_identity: true as const } : {}),
      ...(field.helpText ? { help_text: field.helpText } : {}),
    };
  });
}

/**
 * Fetch and join. The account-wide list is org-scoped and unchanging between
 * calls, so a failure to read it degrades the result rather than failing it -
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
