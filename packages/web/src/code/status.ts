import type { LampState } from "../tui";

const INDEX_LAMPS: Record<string, LampState> = {
  idle: { level: "off", tone: "muted" },
  cloning: { level: "half", tone: "accent" },
  indexing: { level: "half", tone: "accent" },
  ready: { level: "on", tone: "ok" },
  error: { level: "on", tone: "danger" },
};

/** A repo line's index status as a lamp; an unknown one stays dark. */
export const indexLamp = (status: string): LampState =>
  INDEX_LAMPS[status] ?? INDEX_LAMPS.idle;
