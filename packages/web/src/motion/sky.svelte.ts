/** Names a `--star-ink-<tint>` pair in tokens.css. */
export type SkyTint = "red" | "amber" | "green";

const claims = $state<{ id: symbol; tint: SkyTint }[]>([]);

/** Latest claim wins. Returns the release; calling it twice is harmless. */
export function tintSky(tint: SkyTint): () => void {
  const id = Symbol();
  claims.push({ id, tint });
  return () => {
    const i = claims.findIndex((claim) => claim.id === id);
    if (i >= 0) claims.splice(i, 1);
  };
}

export const skyTint = (): SkyTint | null => claims.at(-1)?.tint ?? null;
