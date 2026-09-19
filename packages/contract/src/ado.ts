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

/** One work-item field, as the MCP tool and the HTTP route both project it. */
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
