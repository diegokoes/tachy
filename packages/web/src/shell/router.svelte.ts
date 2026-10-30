const SERVER_SEGMENTS = new Set(["api", "auth", "health", "assets"]);

/** Links to `/admin`, the console's former path, still land. */
const FORMER_CONSOLE = /^\/admin(?=\/|$)/;

function normalizePath(path: string): string {
  return ("/" + path.replace(/^\/+|\/+$/g, ""))
    .replace(/\/{2,}/g, "/")
    .replace(FORMER_CONSOLE, "/console");
}

export const router = $state({ path: normalizePath(window.location.pathname) });

if (FORMER_CONSOLE.test(window.location.pathname))
  history.replaceState({}, "", router.path + window.location.search);

const lastPathBySection = new Map<string, string>();
let currentSection = "";

function visit(path: string) {
  currentSection = path.slice(1).split("/")[0] ?? "";
  if (currentSection) lastPathBySection.set(currentSection, path);
}

/**
 * The section open right now, from outside the reactive graph. A teardown
 * reads state as it was before the change that tore it down, so `segments()`
 * there names the section being left, never the one being entered.
 */
export const sectionNow = () => currentSection;

visit(router.path);

export const segments = () => {
  const path = router.path;
  return path === "/" ? [] : path.slice(1).split("/");
};

export function section(fallback: string): string {
  const first = segments()[0];
  return !first || SERVER_SEGMENTS.has(first) ? fallback : first;
}

export function segment(i: number): string | undefined {
  return segments()[i];
}

/** Unsaved work that leaving the view would throw away. */
export type LeaveGuard = {
  blocks: () => boolean;
  /** Asks the person, and calls `leave` if they choose to go anyway. */
  ask: (leave: () => void) => void;
};

let leaveGuard: LeaveGuard | null = null;

/** Call from a view's `$effect` and return the result, as with `setSubnav`. */
export function setLeaveGuard(guard: LeaveGuard) {
  leaveGuard = guard;
  return () => {
    if (leaveGuard === guard) leaveGuard = null;
  };
}

function go(path: string, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  router.path = path;
  visit(path);
}

export function navigate(to: string, { replace = false } = {}) {
  const path = normalizePath(to);
  if (SERVER_SEGMENTS.has(path.slice(1).split("/")[0] ?? "")) return;
  if (path === router.path) return;
  if (leaveGuard?.blocks()) {
    leaveGuard.ask(() => go(path, { replace }));
    return;
  }
  go(path, { replace });
}

const landings = new Map<string, () => string>();

/**
 * A section's landing, for one whose bare path only redirects onward. Going
 * straight there keeps the address bar from passing through the bare path.
 */
export function setLanding(key: string, to: () => string) {
  landings.set(key, to);
}

const landing = (key: string) => landings.get(key)?.() ?? `/${key}`;

/**
 * Opens a section where it was left. Picking the section already open goes to
 * its landing instead, which is the way back to the top of one.
 */
export function openSection(key: string) {
  navigate(
    segments()[0] === key
      ? landing(key)
      : (lastPathBySection.get(key) ?? landing(key)),
  );
}

export function isActive(prefix: string): boolean {
  const path = normalizePath(prefix);
  return router.path === path || router.path.startsWith(path + "/");
}

export function startRouter() {
  const onPop = () => {
    const path = normalizePath(window.location.pathname);
    if (leaveGuard?.blocks()) {
      // The address bar has already moved; it stays on the view until the
      // person chooses.
      history.pushState({}, "", router.path);
      leaveGuard.ask(() => go(path));
      return;
    }
    router.path = path;
    visit(path);
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    if (leaveGuard?.blocks()) e.preventDefault();
  };
  window.addEventListener("popstate", onPop);
  window.addEventListener("beforeunload", onUnload);
  return () => {
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("beforeunload", onUnload);
  };
}

export function link(node: HTMLAnchorElement) {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = node.getAttribute("href");
    if (!href?.startsWith("/")) return;
    if (node.target && node.target !== "_self") return;
    e.preventDefault();
    navigate(href);
  };
  node.addEventListener("click", onClick);
  return { destroy: () => node.removeEventListener("click", onClick) };
}
