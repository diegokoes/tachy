import { sql, backgroundSettled } from "@tachy/core/infra";
import { clearSettingsCache } from "@tachy/core/config";

export { sql };

export async function resetData() {
  // Tool and source calls are counted in the background; a truncate racing one
  // of those inserts deadlocks.
  await backgroundSettled();
  await sql`
    truncate work_item_messages, work_items, work_item_links, knowledge_feedback,
             reports, report_messages, notifications,
             knowledge_entries, analysis_runs, team_members, users,
             customers, customer_facts, customer_components, customer_units,
             resolution_patterns, components, project_area_map, labels,
             reference_docs, reference_doc_chunks, artifacts, generated_outputs, chat_uploads,
             settings, library_revisions, library_views, source_calls, mcp_tool_calls,
             -- Global-scope rows (user_id and team_id both null) survive the
             -- cascade from users, so name both or a credential written by one
             -- file turns up in the next file on this worker's schema.
             credentials, preferences,
             -- wiki_categories hangs off products, which survive resetData, so
             -- it has to be named or a category outlives the test that made it.
             wiki_categories, wiki_article_categories, wiki_slug_aliases, library_links,
             wiki_gaps, library_assets,
             -- repos would be swept in anyway by the cascade from components;
             -- naming it keeps that visible. source_connections stays.
             repos, repo_lines, repo_line_files, code_blob_chunks,
             flows, flow_runs,
             buckets, bucket_teams, bucket_docs, bucket_doc_chunks
    restart identity cascade
  `;
  // source_projects references customers, so TRUNCATE ... CASCADE takes it with
  // them however the list is written - the cascade follows the FK, not the
  // delete rule. Re-seed the routing fixture rather than fight that.
  await sql`
    insert into source_projects
        (source_connection_id, external_key, name, product_id, team_id)
    select sc.id, '48000641379', 'Test Group', p.id, t.id
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

/** Job and load-run tables, which resetData leaves alone. */
export async function resetJobs() {
  await sql`truncate job_definition_changes, job_definitions, job_runs, job_workers, test_runs cascade`;
}
