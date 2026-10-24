import type { LampState } from "../tui";

/** Where a source's token comes from as a lamp: lit when there is one. */
export const tokenLamp = (tokenSource?: string | null): LampState =>
  tokenSource ? { level: "on", tone: "ok" } : { level: "off", tone: "warn" };
