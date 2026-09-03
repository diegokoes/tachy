import { randomBytes } from "node:crypto";
import { sql, clearSettingsCache } from "@tachy/core";
import { clearSecretKeyCache } from "../packages/core/src/infra/secrets";

export { sql };

export const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

export const cookieOf = (res: Response) =>
  res.headers.get("set-cookie")?.split(";")[0] ?? "";

interface AppLike {
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export async function loginCookie(
  app: AppLike,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.request(
    "/auth/password/login",
    json({ email, password }),
  );
  return cookieOf(res);
}

export function enableVault(): void {
  process.env.TACHY_SECRET_KEY = randomBytes(32).toString("base64");
  clearSecretKeyCache();
}

export function disableVault(): void {
  delete process.env.TACHY_SECRET_KEY;
  clearSecretKeyCache();
}

export async function resetData() {
  await sql`
    truncate work_item_messages, work_items, work_item_links, knowledge_feedback,
             knowledge_entries, analysis_runs, team_members, users,
             customers, customer_facts, customer_components, customer_units,
             resolution_patterns, components, project_area_map, labels,
             reference_docs, reference_doc_chunks, artifacts, generated_outputs,
             settings, library_revisions, library_views,
             -- Global-scope rows (user_id and team_id both null) survive the
             -- cascade from users, so name both or a credential written by one
             -- file turns up in the next file on this worker's schema.
             credentials, preferences,
             -- wiki_categories hangs off products, which survive resetData, so
             -- it has to be named or a category outlives the test that made it.
             wiki_categories, wiki_article_categories, library_links,
             -- repos would be swept in anyway by the cascade from components;
             -- naming it keeps that visible. source_connections stays.
             repos, repo_files, code_chunks
    restart identity cascade
  `;
  // source_projects references customers, so TRUNCATE ... CASCADE takes it with
  // them however the list is written — the cascade follows the FK, not the
  // delete rule. Re-seed the routing fixture rather than fight that.
  await sql`
    insert into source_projects
        (source_connection_id, external_key, name, product_id, team_id, role)
    select sc.id, '48000641379', 'Test Group', p.id, t.id, 'knowledge'
    from source_connections sc
    join products p on p.slug = 'tpd'
    join teams t on t.id = p.team_id and t.slug = 'test-team'
    where sc.slug = 'test-freshdesk'
    on conflict (source_connection_id, external_key) do nothing
  `;
  clearSettingsCache();
}

export async function seededFreshdeskConnId(): Promise<string> {
  const [row] =
    await sql`select id from source_connections where slug = 'test-freshdesk'`;
  return row.id as string;
}

export async function tpdProductId(): Promise<string> {
  const [row] = await sql`select id from products where slug = 'tpd'`;
  return row.id as string;
}
