import { getContext, setContext } from "svelte";

/**
 * What charts drawn side by side share: which series are switched off, and
 * where the pointer is. A chart reads it to dim a series a sibling's legend
 * hid, and to mark the category another chart is being hovered at.
 */
export function createChartGroup() {
  let hidden = $state<string[]>([]);
  let pointer = $state<{ source?: string; key?: string }>({});
  return {
    get hidden() {
      return hidden;
    },
    get pointer() {
      return pointer;
    },
    toggle(key: string) {
      hidden = hidden.includes(key)
        ? hidden.filter((k) => k !== key)
        : [...hidden, key];
    },
    point(source: string, key: string) {
      pointer = { source, key };
    },
    leave(source: string) {
      if (pointer.source === source) pointer = {};
    },
  };
}

export type ChartGroup = ReturnType<typeof createChartGroup>;

const GROUP_KEY = Symbol("chart-group");

export const setChartGroup = (g: ChartGroup) => setContext(GROUP_KEY, g);

/** A chart outside any group gets a group of its own, so it works alone. */
export const getChartGroup = (): ChartGroup =>
  getContext<ChartGroup | undefined>(GROUP_KEY) ?? createChartGroup();
