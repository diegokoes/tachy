const RESERVED = new Set(["api", "auth", "health", "assets"]);

function clean(path: string): string {
  const p = ("/" + path.replace(/^\/+|\/+$/g, "")).replace(/\/{2,}/g, "/");
  return p === "/" ? "/" : p;
}

export const router = $state({ path: clean(window.location.pathname) });

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
}

export function isActive(prefix: string): boolean {
  const p = clean(prefix);
  return router.path === p || router.path.startsWith(p + "/");
}

export function startRouter() {
  const onPop = () => (router.path = clean(window.location.pathname));
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
