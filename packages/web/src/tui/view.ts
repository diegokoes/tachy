import { getContext } from "svelte";

/** What a chart needs to know about the frame it sits in. */
export type TileView = {
  /** Shown whole, in the window, rather than as one tile of the overview. */
  readonly expanded: boolean;
  /** Drawn in a tile, so its height is the tile's rather than its own. */
  readonly tiled: boolean;
  /** Takes the chart out of its tile; absent where there is nowhere to go. */
  open?: () => void;
  /** A list tells its tile whether it had to cut rows, which is what earns the tile an expand button. */
  fold?: (folded: boolean) => void;
};

export const VIEW_KEY = Symbol("tile-view");

const ALONE: TileView = { expanded: false, tiled: false };

/** Call at init: getContext may only run while a component is initialising. */
export const getView = (): TileView =>
  getContext<TileView | undefined>(VIEW_KEY) ?? ALONE;
