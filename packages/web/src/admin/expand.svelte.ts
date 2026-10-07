import { tick } from "svelte";
import { morphTile } from "../motion/motion";
import { navigate, segment } from "../shell/router.svelte";
import { setPeriod } from "./period.svelte";

const SEGMENT = "chart";

/** The tile shown whole in the window, named by `/admin/<page>/chart/<key>`. */
export const expandedKey = (): string | undefined =>
  segment(2) === SEGMENT ? segment(3) : undefined;

export const tilePath = (page: string, key?: string) =>
  key ? `/admin/${page}/${SEGMENT}/${key}` : `/admin/${page}`;

const morphTo = (el: HTMLElement | null, to: string) =>
  morphTile(el, async () => {
    setPeriod(undefined);
    navigate(to);
    await tick();
  });

export const openTile = (page: string, key: string, el: HTMLElement | null) =>
  morphTo(el, tilePath(page, key));

export const closeTile = (page: string) =>
  morphTo(document.querySelector<HTMLElement>(".tile.open"), tilePath(page));
