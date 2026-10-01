/** The JSON Schema an action's params come as, with tachy's `x-` hints. */
export type Schema = {
  type?: string | string[];
  enum?: (string | number)[];
  default?: unknown;
  description?: string;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  "x-options"?: string;
  "x-depends-on"?: string[];
  "x-free"?: boolean;
  "x-form"?: string;
};
