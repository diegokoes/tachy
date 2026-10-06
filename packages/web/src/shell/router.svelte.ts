const SERVER_SEGMENTS = new Set(["api", "auth", "health", "assets"]);

function normalizePath(path: string): string {
  const p = ("/" + path.replace(/^\/+|\/+$/g, "")).replace(/\/{2,}/g, "/");
  return p === "/" ? "/" : p;
}

export const router = $state({ path: normalizePath(window.location.pathname) });

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

export function navigate(to: string, { replace = false } = {}) {
  const path = normalizePath(to);
  if (SERVER_SEGMENTS.has(path.slice(1).split("/")[0] ?? "")) return;
  if (path === router.path) return;
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  router.path = path;
  visit(path);
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
    router.path = normalizePath(window.location.pathname);
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
