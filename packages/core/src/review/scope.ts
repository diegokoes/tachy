import { sql } from "../infra/db";

/** The teams a reviewer curates. Null is an app admin, who reviews every team's. */
export type ReviewerTeams = string[] | null;

/** Written against the alias `e`: the entry's own team, or its product's. */
export const curatedBy = (teamIds: ReviewerTeams) =>
  teamIds === null
    ? sql`true`
    : sql`(
        e.team_id = any(${teamIds}::uuid[])
        or exists (
          select 1 from products product
          where product.id = e.product_id
            and product.team_id = any(${teamIds}::uuid[])
        )
      )`;
