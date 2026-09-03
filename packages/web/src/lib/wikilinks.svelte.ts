import { api } from "./api";
import { navigate } from "./router.svelte";
import type { NamedRow } from "./types";

export interface OutboundLink {
  target: string;
  to_doc_id: string | null;
  to_entry_id: string | null;
  to_slug: string | null;
  to_kind: string | null;
  to_product_id: string | null;
}

/**
 * Where each `[[target]]` in one body actually points, and a click handler that
 * follows it. Shared by the article, doc and entry views — the third copy was
 * the point at which pasting it again stopped being defensible.
 *
 * Destinations come from what the SERVER resolved, not from re-deriving them in
 * the browser: link resolution is scoped (a product's wiki first, then the
 * org-wide one), and a client guessing at that scope would send readers to the
 * wrong article whenever the two disagree.
 */
export class LinkTargets {
  /** Targets that resolved; anything else renders as a broken link. */
  resolved = $state<Set<string>>(new Set());
  private to = new Map<string, string>();

  async load(base: "knowledge" | "reference", id: string): Promise<void> {
    try {
      const [{ outbound }, products] = await Promise.all([
        api.get<{ outbound: OutboundLink[] }>(`/${base}/${id}/links`),
        api.get<NamedRow[]>("/products").catch(() => [] as NamedRow[]),
      ]);
      const scopeOf = (productId: string | null) =>
        products.find((p) => p.id === productId)?.slug ?? "general";

      const next = new Set<string>();
      this.to.clear();
      for (const l of outbound) {
        if (l.to_entry_id) {
          next.add(l.target);
          this.to.set(l.target, `/library/entries/${l.to_entry_id}`);
        } else if (l.to_doc_id) {
          next.add(l.target);
          this.to.set(
            l.target,
            l.to_kind === "wiki" && l.to_slug
              ? `/library/wiki/${scopeOf(l.to_product_id)}/${l.to_slug}`
              : `/library/docs/${l.to_doc_id}`,
          );
        }
      }
      this.resolved = next;
    } catch {
      this.resolved = new Set();
      this.to.clear();
    }
  }

  /**
   * One delegated handler rather than one per link: the body is injected with
   * {@html}, so there are no components to attach listeners to.
   */
  onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement)?.closest?.("a[data-wikilink]");
    const target = el?.getAttribute("data-wikilink");
    if (!target) return;
    e.preventDefault();
    const to = this.to.get(target);
    if (to) navigate(to);
  };
}
