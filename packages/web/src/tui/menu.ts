import type { IconName } from "./icons";

/** One row of a corner Menu. */
export type MenuItem = {
  key: string;
  label: string;
  /** Said quietly at the right of the row, such as a count. */
  hint?: string;
  icon?: IconName;
  /** A CSS colour for the icon, such as a work item type's own. */
  color?: string;
  /** The row the reader is on: marked ›, and where the cursor starts. */
  current?: boolean;
};
