/**
 * How often each place was picked, so the palette opens on the ones used most,
 * the way a launcher remembers what it launched. Per browser, and only a
 * convenience: losing it just opens in catalogue order.
 */

const KEY = "tachy-palette";

export function picks(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

export function countPick(id: string): void {
  const counts = picks();
  counts[id] = (counts[id] ?? 0) + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(counts));
  } catch {
    // private window or blocked storage
  }
}
