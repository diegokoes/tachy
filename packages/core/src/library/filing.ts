import { badInput } from "../infra/errors";
import {
  getComponentSlug,
  resolveComponentStrict,
} from "../catalog/components";
import { getCustomerIdBySlug, getCustomerSlug } from "../catalog/customers";
import { getUnitSlug, resolveUnit } from "../catalog/units";

/**
 * Where a knowledge entry or reference doc is filed: its component (with the
 * product_area derived from it) and the customer and unit it is about.
 */
export interface Filing {
  componentId: string | null;
  productArea: string | null;
  customerId: string | null;
  customerUnitId: string | null;
}

/** The filing columns as a library row stores them. */
export interface FiledRow {
  product_id: string | null;
  component_id: string | null;
  product_area: string | null;
  customer_id: string | null;
  customer_unit_id: string | null;
}

/**
 * Component slugs resolve within a product, so naming one without a product is
 * ambiguous rather than merely incomplete. `noProduct` is the error for that.
 */
export async function resolveFilingComponent(
  productId: string | null,
  component: string | null | undefined,
  noProduct: string,
): Promise<Pick<Filing, "componentId" | "productArea">> {
  if (!component) return { componentId: null, productArea: null };
  if (!productId) throw badInput(noProduct);
  const resolved = await resolveComponentStrict(productId, component);
  return { componentId: resolved.id, productArea: resolved.path };
}

/** Customer and unit for a new item. A unit needs a stated customer. */
export async function statedCustomer(
  customerSlug: string | null | undefined,
  unit: string | null | undefined,
): Promise<Pick<Filing, "customerId" | "customerUnitId">> {
  const customerId = customerSlug
    ? await getCustomerIdBySlug(customerSlug)
    : null;
  if (unit && !customerId)
    throw badInput("a unit needs its customer: pass customer_slug with unit");
  return {
    customerId,
    customerUnitId:
      unit && customerId ? (await resolveUnit(customerId, unit)).id : null,
  };
}

/**
 * The filing an update leaves behind. A key present in `patch` replaces the
 * stored value and null clears it; an absent key keeps it. The unit follows
 * the customer: re-filing under another customer, or clearing it, drops a unit
 * that belongs to the old one, which would otherwise resolve facts from an
 * estate the item is not about.
 */
export async function patchedFiling(
  current: FiledRow,
  patch: {
    component?: string | null;
    customerSlug?: string | null;
    unit?: string | null;
  },
  noProduct: string,
): Promise<Filing> {
  const { componentId, productArea } =
    "component" in patch
      ? await resolveFilingComponent(
          current.product_id,
          patch.component,
          noProduct,
        )
      : {
          componentId: current.component_id,
          productArea: current.product_area,
        };
  const customerId =
    "customerSlug" in patch
      ? patch.customerSlug
        ? await getCustomerIdBySlug(patch.customerSlug)
        : null
      : current.customer_id;
  let customerUnitId =
    customerId === current.customer_id ? current.customer_unit_id : null;
  if ("unit" in patch) {
    if (patch.unit && !customerId)
      throw badInput("a unit needs its customer: set customerSlug with unit");
    customerUnitId =
      patch.unit && customerId
        ? (await resolveUnit(customerId, patch.unit)).id
        : null;
  }
  return { componentId, productArea, customerId, customerUnitId };
}

/**
 * A revision's filing as the slugs an update takes. All three are returned
 * even when null: a revert that omitted one would keep the live value instead
 * of restoring the revision's.
 */
export async function filingSlugs(snapshot: Partial<FiledRow>): Promise<{
  component: string | null;
  customerSlug: string | null;
  unit: string | null;
}> {
  const [component, customerSlug, unit] = await Promise.all([
    getComponentSlug(snapshot.component_id ?? null),
    getCustomerSlug(snapshot.customer_id ?? null),
    getUnitSlug(snapshot.customer_unit_id ?? null),
  ]);
  return { component, customerSlug, unit };
}
