import type { AdoClient } from "./client";

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

/** ADO's FieldType values, as seen in the account-wide field list. */
export type AdoFieldType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "dateTime"
  | "plainText"
  | "html"
  | "treePath"
  | "history"
  | "guid"
  | "identity"
  | "picklistString";

export interface FieldSpec {
  reference_name: string;
  name: string;
  required: boolean;
  allowed_values?: unknown[];
  allowed_values_truncated?: true;
  default_value?: unknown;
  /** From the account-wide list; absent when the field is not defined there. */
  type?: AdoFieldType;
  read_only?: true;
  /**
   * An identity field takes a person. ADO resolves the string server-side and
   * rejects one it cannot match, so an email / unique name is the reliable
   * form — a display name alone is ambiguous.
   */
  is_identity?: true;
  help_text?: string;
}

export interface WorkItemSchema {
  project: string;
  type: string;
  fields: FieldSpec[];
  config_defaults: Record<string, unknown>;
}

/**
 * The projection both the MCP tool and the HTTP route return. One function so
 * they cannot drift: a field the browser renders and a field the agent is told
 * about have to be the same field.
 */
export function projectFields(
  typeFields: any[],
  accountFields: any[] = [],
): FieldSpec[] {
  const byRef = new Map<string, any>();
  for (const f of accountFields)
    if (f?.referenceName) byRef.set(f.referenceName, f);

  return typeFields.map((f: any) => {
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
    client.listFields().catch(() => [] as any[]),
  ]);
  return {
    project,
    type,
    fields: projectFields(typeFields, accountFields),
    config_defaults: configDefaults,
  };
}
