import {
  JOB_RESOURCE_CLASSES,
  backgroundSettled,
  loadSettingsIntoEnv,
  log,
  registerSource,
  setSourceOrigin,
  sql,
  startJobProcess,
} from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);
setSourceOrigin("sync");

const classes = (process.env.TACHY_WORKER_CLASSES ?? "light")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);
for (const c of classes)
  if (!(JOB_RESOURCE_CLASSES as readonly string[]).includes(c))
    throw new Error(`TACHY_WORKER_CLASSES: unknown class '${c}'`);
const concurrency = Number(process.env.TACHY_WORKER_CONCURRENCY) || 1;
const drainMs = (Number(process.env.TACHY_DRAIN_SECONDS) || 120) * 1000;

await loadSettingsIntoEnv().catch(() => {});
const worker = await startJobProcess({ classes, concurrency });

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log("info", "job_worker_drain", { signal, active: worker.active });
  await worker.drain(drainMs);
  await backgroundSettled();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));
