export type Binding = {
  /** A normalized key, or a space-separated sequence of them — e.g. "g g". */
  key: string;
  label: string;
  run: () => void;
  inFields?: boolean;
  hidden?: boolean;
};

/** How long a half-typed sequence waits for its next key before lapsing. */
const SEQUENCE_MS = 700;

type Scope = { bindings: Binding[] };

const scopes: Scope[] = [];
let seq = 0;
let stamp = $state.raw(0);

/** Innermost scope wins — a modal's bindings shadow the view's. */
const top = (): Scope | undefined => scopes[scopes.length - 1];

export function hints(): { key: string; label: string }[] {
  void stamp;
  return (top()?.bindings ?? [])
    .filter((b) => !b.hidden && b.label)
    .map(({ key, label }) => ({ key, label }));
}

export function pushScope(bindings: Binding[]) {
  const scope: Scope = { bindings };
  scopes.push(scope);
  stamp = ++seq;
  return () => {
    const i = scopes.indexOf(scope);
    if (i >= 0) scopes.splice(i, 1);
    stamp = ++seq;
  };
}

function inTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Exported so the rebind UI captures exactly the shape dispatch matches on. */
export function normalize(e: KeyboardEvent, ctrl = false): string {
  if (e.shiftKey && /^Digit[1-9]$/.test(e.code))
    return `shift+${e.code.slice(5)}`;
  // Shifted letters are their own binding — vim's G is not its j.
  if (e.shiftKey && /^Key[A-Z]$/.test(e.code))
    return `shift+${e.code.slice(3).toLowerCase()}`;
  const base =
    e.key === " "
      ? "space"
      : e.key === "Enter"
        ? "⏎"
        : e.key === "Escape"
          ? "esc"
          : e.key === "ArrowUp"
            ? "↑"
            : e.key === "ArrowDown"
              ? "↓"
              : e.key.toLowerCase();
  return ctrl ? `ctrl+${base}` : base;
}

export function startKeys() {
  /* Keys typed so far towards a multi-key binding. A lone `g` is not a binding
     on its own, so it has to be held until either its partner arrives or the
     window lapses — and it must lapse, or a stray `g` would arm the next
     unrelated keystroke indefinitely. */
  let pending: string[] = [];
  let lapse: ReturnType<typeof setTimeout> | undefined;

  const clearPending = () => {
    pending = [];
    if (lapse) clearTimeout(lapse);
    lapse = undefined;
  };

  /* Innermost scope wins, and it wins whole: a scope that has a sequence
     starting with this chord claims it, even if an outer scope binds the same
     chord on its own. Otherwise a modal's `g g` would be shadowed by the
     view's `g` and never complete. */
  const match = (chord: string, field: boolean): Binding | "partial" | null => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      let exact: Binding | undefined;
      let partial = false;
      for (const b of scopes[i].bindings) {
        if (field && !b.inFields) continue;
        if (b.key === chord) exact ??= b;
        else if (b.key.startsWith(`${chord} `)) partial = true;
      }
      if (partial) return "partial";
      if (exact) return exact;
    }
    return null;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.altKey) return;
    const pressed = normalize(e, e.ctrlKey);
    const field = inTextField(e.target);

    const chord = [...pending, pressed].join(" ");
    const hit = match(chord, field);

    if (hit === "partial") {
      pending = [...pending, pressed];
      if (lapse) clearTimeout(lapse);
      lapse = setTimeout(clearPending, SEQUENCE_MS);
      e.preventDefault();
      return;
    }
    if (hit) {
      clearPending();
      e.preventDefault();
      hit.run();
      return;
    }

    // No sequence continues — fall back to reading this key on its own, so a
    // lapsed prefix never eats the keystroke that follows it.
    if (pending.length) {
      clearPending();
      const solo = match(pressed, field);
      if (solo === "partial") {
        pending = [pressed];
        lapse = setTimeout(clearPending, SEQUENCE_MS);
        e.preventDefault();
      } else if (solo) {
        e.preventDefault();
        solo.run();
      }
    }
  };

  window.addEventListener("keydown", onKey);
  return () => {
    clearPending();
    window.removeEventListener("keydown", onKey);
  };
}
