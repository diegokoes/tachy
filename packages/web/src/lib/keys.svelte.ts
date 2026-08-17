export type Binding = {
  key: string;
  label: string;
  run: () => void;
  inFields?: boolean;
  hidden?: boolean;
};

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

function normalize(e: KeyboardEvent, ctrl = false): string {
  if (e.shiftKey && /^Digit[1-9]$/.test(e.code))
    return `shift+${e.code.slice(5)}`;
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
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.altKey) return;
    const pressed = normalize(e, e.ctrlKey);
    const field = inTextField(e.target);
    for (let i = scopes.length - 1; i >= 0; i--) {
      for (const b of scopes[i].bindings) {
        if (b.key !== pressed) continue;
        if (field && !b.inFields) continue;
        e.preventDefault();
        b.run();
        return;
      }
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
