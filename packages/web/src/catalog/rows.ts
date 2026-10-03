import type {
  ComponentKnowledge,
  ComponentNode,
  ComponentRow,
  CustomerRow,
  LabelRow,
  PatternRow,
  ProductRow,
  TeamRow,
} from "@tachy/contract";

/**
 * The shapes the admin panels render - one per table they administer, as the
 * API returns them.
 */
export type Team = TeamRow;
export type Product = ProductRow;
export type Component = ComponentRow;
export type Label = LabelRow;
export type Customer = CustomerRow;
export type Pattern = PatternRow;

/** `GET /overview/components`: every component, with the entries filed under it. */
export type ComponentCoverage = Pick<
  ComponentNode,
  "id" | "parent_id" | "slug" | "name" | "product_slug" | "product_name"
> &
  Omit<ComponentKnowledge, "component_id">;
