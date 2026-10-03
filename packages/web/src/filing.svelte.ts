import type {
  ComponentRow,
  CustomerRow,
  CustomerUnitRow,
  ProductRow,
} from "@tachy/contract";
import { api } from "./api";
import { componentOptions } from "./catalog";
import { errText } from "./resource.svelte";
import { canCurateScope } from "./session.svelte";
import { t } from "./terms";

/** The ids and slugs of the row being edited; `product_id` only when editing. */
type FilingSeed = {
  product_id?: string | null;
  component_id?: string | null;
  customer_slug?: string | null;
  customer_unit_slug?: string | null;
};

const componentsOf = (productSlug: string) =>
  api.get<ComponentRow[]>(`/products/${productSlug}/components`);

/**
 * The product, component, customer and unit a library form files an item
 * under. Components resolve within a product and units within a customer, so
 * each list reloads when its parent changes and drops a pick it no longer
 * holds. The row carries ids; the controls and the API speak slugs.
 */
export class Filing {
  products = $state<ProductRow[]>([]);
  components = $state<ComponentRow[]>([]);
  customers = $state<CustomerRow[]>([]);
  units = $state<CustomerUnitRow[]>([]);
  productSlug = $state("");
  component = $state("");
  customerSlug = $state("");
  unitSlug = $state("");
  error = $state<string | null>(null);

  productOptions = $derived([
    { value: "", label: `no ${t("product")}` },
    ...this.products
      .filter((p) => canCurateScope({ team_slug: p.team_slug }))
      .map((p) => ({ value: p.slug, label: `${p.name} (${p.team_slug})` })),
  ]);
  componentChoices = $derived(componentOptions(this.components));
  customerOptions = $derived([
    { value: "", label: "none (general)" },
    ...this.customers.map((c) => ({ value: c.slug, label: c.name })),
  ]);
  unitOptions = $derived([
    { value: "", label: "the whole account" },
    ...this.units.map((u) => ({
      value: u.slug,
      label: `${u.name} (${u.kind})`,
    })),
  ]);

  private seed: FilingSeed;

  constructor(seed: FilingSeed) {
    this.seed = seed;
    this.customerSlug = seed.customer_slug ?? "";
    this.unitSlug = seed.customer_unit_slug ?? "";
  }

  async load(): Promise<void> {
    try {
      [this.products, this.customers] = await Promise.all([
        api.get<ProductRow[]>("/products"),
        api.get<CustomerRow[]>("/customers"),
      ]);
      this.productSlug =
        this.products.find((p) => p.id === this.seed.product_id)?.slug ?? "";
      await Promise.all([this.productChanged(), this.customerChanged()]);
      this.component =
        this.components.find((c) => c.id === this.seed.component_id)?.slug ??
        "";
    } catch (e) {
      this.error = errText(e);
    }
  }

  async productChanged(): Promise<void> {
    try {
      this.components = this.productSlug
        ? await componentsOf(this.productSlug)
        : [];
    } catch (e) {
      this.components = [];
      this.error = errText(e);
    }
    if (!this.components.some((c) => c.slug === this.component))
      this.component = "";
  }

  async customerChanged(): Promise<void> {
    try {
      this.units = this.customerSlug
        ? await api.get<CustomerUnitRow[]>(
            `/customers/${this.customerSlug}/units`,
          )
        : [];
    } catch (e) {
      this.units = [];
      this.error = errText(e);
    }
    if (!this.units.some((u) => u.slug === this.unitSlug)) this.unitSlug = "";
  }

  /**
   * The filing half of a create or update body. An edit sends null for an
   * emptied pick so the server clears it; a create leaves it out.
   */
  payload(mode: "create" | "edit"): Record<string, unknown> {
    const cleared = mode === "edit" ? null : undefined;
    const productId =
      mode === "create"
        ? this.products.find((p) => p.slug === this.productSlug)?.id
        : undefined;
    return {
      component: this.component || cleared,
      customerSlug: this.customerSlug || cleared,
      unit: this.unitSlug || cleared,
      ...(productId ? { productId } : {}),
    };
  }
}

/** Components per product slug, each fetched once for the life of the cache. */
export class ComponentCache {
  byProduct = $state<Record<string, ComponentRow[]>>({});

  async load(productSlug: string): Promise<void> {
    if (!productSlug || this.byProduct[productSlug]) return;
    this.byProduct[productSlug] = await componentsOf(productSlug).catch(
      () => [],
    );
  }

  of(productSlug: string): ComponentRow[] {
    return this.byProduct[productSlug] ?? [];
  }
}
