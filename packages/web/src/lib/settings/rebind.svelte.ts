import {
  conflicts,
  keyLabel,
  setNavKey,
  setSubnavKey,
} from "../keys/bindings.svelte";
import { normalize } from "../keys.svelte";
import { navItems } from "../nav";

export type Target =
  | { kind: "nav"; item: string }
  | { kind: "subnav"; slot: number }
  | { kind: "settings" };

/** The widest subnav in the app; admin, wiki and library all run three deep. */
export const SUBNAV_SLOTS = 3;

/**
 * What is currently listening for a key, shared by the two rebind sections.
 * They are separate parts of one scrolling page now, and arming a row in one
 * has to disarm whatever the other had armed — a second live listener would
 * record the same press into two bindings.
 */
export const rebind = $state({
  target: null as Target | null,
  warning: "",
});

export function arm(target: Target | null) {
  rebind.target = target;
  rebind.warning = "";
}

export const isArming = (t: Target) => {
  const now = rebind.target;
  if (!now || now.kind !== t.kind) return false;
  if (now.kind === "nav" && t.kind === "nav") return now.item === t.item;
  if (now.kind === "subnav" && t.kind === "subnav") return now.slot === t.slot;
  return true;
};

/**
 * Captured through the dispatcher's own normalize(), so a key recorded here is
 * byte-for-byte the string a keypress will later be matched against — anything
 * else silently records bindings that can never fire. Modifier-only presses are
 * ignored: you cannot bind Shift by itself.
 */
export function capture(e: KeyboardEvent) {
  const target = rebind.target;
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") {
    arm(null);
    return;
  }
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;

  const key = normalize(e, e.ctrlKey);
  const hits = conflicts(key, navItems(), SUBNAV_SLOTS, target);
  if (hits.length) {
    rebind.warning = `${keyLabel(key)} is already ${hits.join(" and ")}.`;
    return;
  }
  if (target.kind === "nav") setNavKey(target.item, key);
  else if (target.kind === "subnav") setSubnavKey(target.slot, key);
  else setNavKey("settings", key);
  arm(null);
}
