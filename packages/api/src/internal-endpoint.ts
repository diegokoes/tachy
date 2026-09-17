/**
 * Set by the server at boot: where the MCP children it spawns reach it for
 * embedding and for their log lines, and the per-boot secret they present.
 */
export let internalEndpoint: { baseUrl: string; secret: string } | undefined;

export function setInternalEndpoint(value: typeof internalEndpoint): void {
  internalEndpoint = value;
}
