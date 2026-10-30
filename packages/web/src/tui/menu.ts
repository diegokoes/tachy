import type { IconName } from "./icons";
import type { Lamp } from "./lamp";

/** One row of a corner Menu. */
export type MenuItem = {
  key: string;
  label: string;
  /** Said quietly at the right of the row, such as a count. */
  hint?: string;
  icon?: IconName;
  /** A CSS colour for the icon, such as a work item type's own. */
  color?: string;
  /** A status row's lamp, drawn in place of an icon. */
  lamp?: Lamp;
  /** The row the reader is on: marked ›, and where the cursor starts. */
  current?: boolean;
};
