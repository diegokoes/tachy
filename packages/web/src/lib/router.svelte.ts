const RESERVED = new Set(["api", "auth", "health", "assets"]);

function clean(path: string): string {
  const p = ("/" + path.replace(/^\/+|\/+$/g, "")).replace(/\/{2,}/g, "/");
  return p === "/" ? "/" : p;
}

export const router = $state({ path: clean(window.location.pathname) });

/** The path each section was last on, so going back to one resumes there. */
const lastIn = new Map<string, string>();
let at = "";

function visit(path: string) {
  at = path.slice(1).split("/")[0] ?? "";
  if (at) lastIn.set(at, path);
}

/**
 * The section open right now, from outside the reactive graph. A teardown
 * reads state as it was before the change that tore it down, so `segments()`
 * there names the section being left, never the one being entered.
 */
export const sectionNow = () => at;

visit(router.path);

export const segments = () => {
  const p = router.path;
  return p === "/" ? [] : p.slice(1).split("/");
};

export function section(fallback: string): string {
  const s = segments()[0];
  return !s || RESERVED.has(s) ? fallback : s;
}

export function segment(i: number): string | undefined {
  return segments()[i];
}

export function navigate(to: string, { replace = false } = {}) {
  const path = clean(to);
  if (RESERVED.has(path.slice(1).split("/")[0] ?? "")) return;
  if (path === router.path) return;
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  router.path = path;
  visit(path);
}

/**
 * Opens a section where it was left. Picking the section already open goes to
 * its landing instead, which is the way back to the top of one.
 */
export function openSection(key: string) {
  navigate(segments()[0] === key ? `/${key}` : (lastIn.get(key) ?? `/${key}`));
}

export function isActive(prefix: string): boolean {
  const p = clean(prefix);
  return router.path === p || router.path.startsWith(p + "/");
}

export function startRouter() {
  const onPop = () => {
    router.path = clean(window.location.pathname);
    visit(router.path);
  };
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
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
