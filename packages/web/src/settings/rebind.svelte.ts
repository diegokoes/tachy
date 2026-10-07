import {
  conflicts,
  defaultNavKey,
  ACTIONS,
  actionKey,
  type Action,
  defaultSubnavKey,
  keyLabel,
  keymap,
  navKey,
  setNavKey,
  setSubnavKey,
  subnavKey,
} from "../keys/bindings.svelte";
import { normalize } from "../keys/keys.svelte";
import { navItems } from "../shell/nav";

export type Target =
  | { kind: "nav"; item: string }
  | { kind: "subnav"; slot: number }
  | { kind: "action"; item: Action };

/** The widest subnav in the app; admin, wiki and library all run three deep. */
export const SUBNAV_SLOTS = 3;

/**
 * The binding open in the rebind dialog, and the press it has recorded so far.
 * A press is held rather than saved on the spot, so a key that collides can be
 * shown with its reason and a slip can be pressed over before anything changes.
 */
export const rebind = $state({
  target: null as Target | null,
  label: "",
  pending: null as string | null,
  /** What is down this instant, shown before the press completes. */
  held: null as string | null,
  warning: "",
});

export function open(target: Target | null, label = "") {
  rebind.target = target;
  rebind.label = label;
  rebind.pending = null;
  rebind.held = null;
  rebind.warning = "";
}

export const close = () => open(null);

export function boundKey(t: Target): string {
  if (t.kind === "subnav") return subnavKey(t.slot);
  if (t.kind === "action") return actionKey(t.item);
  return navKey(
    t.item,
    navItems().findIndex((n) => n.key === t.item),
  );
}

export function defaultKey(t: Target): string {
  if (t.kind === "subnav") return defaultSubnavKey(t.slot);
  if (t.kind === "action") return ACTIONS[t.item].key;
  return defaultNavKey(navItems().findIndex((n) => n.key === t.item));
}

export function customized(t: Target): boolean {
  if (t.kind === "subnav") return t.slot in keymap.subnav;
  return t.item in keymap.nav;
}

function write(t: Target, key: string | null) {
  if (t.kind === "subnav") setSubnavKey(t.slot, key);
  else setNavKey(t.item, key);
}

const MODIFIERS = ["Shift", "Control", "Alt", "Meta"];

/**
 * The modifiers `normalize()` can record, as held at this instant. Alt and Meta
 * are left out: a chord never carries them, so showing them would promise a
 * binding that is not the one saved.
 */
const heldMods = (e: KeyboardEvent) =>
  [e.ctrlKey && "ctrl", e.shiftKey && "shift"].filter(Boolean).join("+") ||
  null;

/**
 * Captured through the dispatcher's own normalize(), so a key recorded here is
 * the string a keypress is later matched against. A modifier on its own is
 * shown as it goes down but never recorded. Escape and Tab go on to the dialog,
 * which closes and traps focus with them; so does Enter once a usable key is
 * held, as the dialog's confirm.
 */
export function capture(e: KeyboardEvent) {
  const target = rebind.target;
  if (!target) return;
  if (e.key === "Escape" || e.key === "Tab") return;
  if (e.key === "Enter" && rebind.pending && !rebind.warning) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (MODIFIERS.includes(e.key)) {
    rebind.held = heldMods(e);
    return;
  }

  const key = normalize(e, e.ctrlKey);
  const hits = conflicts(key, navItems(), SUBNAV_SLOTS, target);
  rebind.held = key;
  rebind.pending = key;
  rebind.warning = hits.length
    ? `${keyLabel(key)} is already ${hits.join(" and ")}.`
    : "";
}

/**
 * Keyup updates the held caps: letting go of K while Ctrl is still down leaves
 * CTRL showing, and letting go of everything leaves the recorded chord.
 */
export function release(e: KeyboardEvent) {
  if (!rebind.target) return;
  rebind.held = heldMods(e);
}

export const letGo = () => (rebind.held = null);

export function save() {
  const { target, pending, warning } = rebind;
  if (!target || !pending || warning) return;
  write(target, pending === defaultKey(target) ? null : pending);
  close();
}

export function restore() {
  if (!rebind.target) return;
  write(rebind.target, null);
  close();
}
