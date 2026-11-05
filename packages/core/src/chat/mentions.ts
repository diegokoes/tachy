import { projectToken, type Mention, type Mentionables } from "@tachy/contract";
import { readableBucket, readableBuckets } from "../buckets/access";
import { getCustomerIdBySlug } from "../catalog/customers";
import { resolveUnit } from "../catalog/units";
import { sql } from "../infra/db";
import { getRepoBySlug, listRepos, reposInProject } from "../code/repos";

/** Customers, and the units of their setups as `customer/unit`, for the `@` picker. */
async function customerMentionables(): Promise<Mentionables["customers"]> {
  return sql<Mentionables["customers"]>`
    select slug as key, name from customers
    union all
    select c.slug || '/' || u.slug, u.name || ' (' || u.kind || ')'
    from customer_units u join customers c on c.id = u.customer_id
    order by key
  `;
}

/** Every repo, since repos carry no team; buckets only where shared with the user. */
export async function listMentionables(
  userId: string | null,
): Promise<Mentionables> {
  const [repos, buckets, customers] = await Promise.all([
    listRepos(),
    readableBuckets(userId),
    customerMentionables(),
  ]);
  const projects = new Set(
    repos.flatMap((r) => (r.project_key ? [projectToken(r.project_key)] : [])),
  );
  return {
    repos: repos.map((r) => ({
      slug: r.slug,
      product_slug: r.product_slug,
      project: r.project_key ? projectToken(r.project_key) : null,
    })),
    buckets: buckets.map((b) => ({ slug: b.slug, name: b.name })),
    projects: [...projects].sort(),
    customers: [...customers],
  };
}

/** A customer mention names the customer, and after a slash one unit of theirs. */
async function checkCustomerMention(key: string): Promise<void> {
  const [customer, unit] = key.split("/");
  const customerId = await getCustomerIdBySlug(customer);
  if (unit) await resolveUnit(customerId, unit);
}

/** Throws not-found or forbidden for the first mention the user cannot attach. */
export async function checkMentions(
  userId: string | null,
  mentions: Mention[],
): Promise<void> {
  for (const mention of mentions) {
    if (mention.kind === "repo") await getRepoBySlug(mention.key);
    else if (mention.kind === "bucket")
      await readableBucket(userId, mention.key);
    else if (mention.kind === "customer")
      await checkCustomerMention(mention.key);
    else await reposInProject(mention.key);
  }
}
