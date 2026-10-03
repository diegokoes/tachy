/** The JSON Schema an action's params come as, with tachy's `x-` hints. */
export type Schema = {
  type?: string | string[];
  enum?: (string | number)[];
  default?: unknown;
  /** A short label for the field; the param's key when absent. */
  title?: string;
  description?: string;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  "x-options"?: string;
  "x-depends-on"?: string[];
  "x-free"?: boolean;
  "x-form"?: string;
  /** On an output record: its keys are the values of this sibling param. */
  "x-keys-from"?: string;
};
