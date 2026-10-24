import type { ReportStatus } from "@tachy/contract";
import type { LampState } from "../tui";

/** Open is lit in warn: it waits on someone. Closed is dark: nothing to do. */
const REPORT_LAMPS: Record<ReportStatus, LampState> = {
  open: { level: "on", tone: "warn" },
  in_progress: { level: "half", tone: "accent" },
  resolved: { level: "on", tone: "ok" },
  closed: { level: "off", tone: "muted" },
};

export const reportLamp = (status: ReportStatus): LampState =>
  REPORT_LAMPS[status];
