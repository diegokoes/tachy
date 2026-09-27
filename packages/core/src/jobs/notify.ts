import { resolveCredential } from "../config/credentials";
import { sql } from "../infra/db";
import { log } from "../infra/log";
import type { JobRun } from "./runs";

/** The vault credential holding the Teams workflow URL for job notifications. */
export const JOB_WEBHOOK_CREDENTIAL = "teams_job_webhook";

/**
 * Posts a finished run to Teams when its definition asks for it. Host alerts
 * use tachy-watch's own URL instead, so they work with the application down.
 */
export async function notifyRunFinished(run: JobRun): Promise<void> {
  if (!run.definition_id) return;
  const [d] =
    await sql`select name, notify from job_definitions where id = ${run.definition_id}`;
  if (!d || d.notify === "never") return;
  if (d.notify === "failure" && run.status === "succeeded") return;
  const url = await resolveCredential(JOB_WEBHOOK_CREDENTIAL, {});
  if (!url) return;
  const text = `**${d.name}** (${run.kind}) ${run.status}${run.error ? `: ${run.error}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.2",
            body: [{ type: "TextBlock", wrap: true, text }],
          },
        },
      ],
    }),
  }).catch((err) => {
    log("warn", "job_notify_failed", { run: run.id, error: String(err) });
    return null;
  });
  if (res && !res.ok)
    log("warn", "job_notify_failed", { run: run.id, status: res.status });
}
