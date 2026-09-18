/** Set by the server at boot; the MCP children it spawns embed through it. */
export let embedEndpoint: { url: string; secret: string } | undefined;

export function setEmbedEndpoint(value: typeof embedEndpoint): void {
  embedEndpoint = value;
}
