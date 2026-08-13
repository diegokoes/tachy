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
             customers, resolution_patterns, components, project_area_map, labels,
             reference_docs, reference_doc_chunks, artifacts, generated_outputs,
             settings,
             -- repos would be swept in anyway by the cascade from components;
             -- naming it keeps that visible. source_connections/source_projects
             -- stay, so the seeded routing fixture survives.
             repos, repo_files, code_chunks
    restart identity cascade
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
