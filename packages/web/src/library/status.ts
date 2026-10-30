import type { IconName, LampState, MenuItem } from "../tui";

/**
 * A library item's status as a lamp. One map over the union of both
 * vocabularies: knowledge entries can be rejected or deprecated and reference
 * docs cannot, so a doc never reaches those rows, and the two views cannot
 * draw a status differently.
 */
const STATUS_LAMPS: Record<string, LampState> = {
  approved: { level: "on", tone: "ok" },
  draft: { level: "half", tone: "accent" },
  deprecated: { level: "half", tone: "warn" },
  rejected: { level: "off", tone: "danger" },
  archived: { level: "off", tone: "muted" },
};
const UNKNOWN_STATUS: LampState = { level: "off", tone: "muted" };

export const statusLamp = (status: string): LampState =>
  STATUS_LAMPS[status] ?? UNKNOWN_STATUS;

/**
 * A status menu's rows, the current one marked, each saying whether search
 * returns an item in that status.
 */
export function statusItems(
  statuses: readonly string[],
  current: string,
  searched: readonly string[],
): MenuItem[] {
  return statuses.map((status) => ({
    key: status,
    label: status,
    lamp: statusLamp(status),
    hint: searched.includes(status) ? "searched" : "not searched",
    current: status === current,
  }));
}

/** One lifecycle action on a library item, as the left rail draws it. */
export type StatusAction = {
  icon: IconName;
  /** Drawn uppercase by the rail; write it in prose case. */
  label: string;
  title?: string;
  tone?: "danger" | "ok" | "info" | "accent" | "warn";
  disabled?: boolean;
  onclick: () => void;
};
