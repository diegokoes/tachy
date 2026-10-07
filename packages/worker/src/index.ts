import { JOB_QUEUE_NAMES, JOB_RESOURCE_CLASSES, jobQueue } from "@tachy/core";
import { backgroundSettled, log, sql } from "@tachy/core/infra";
import { loadSettingsIntoEnv } from "@tachy/core/config";
import { registerSource, setSourceOrigin } from "@tachy/core/sources";
import { startJobProcess } from "@tachy/core/jobs";
import { registerAgentFlowActions } from "@tachy/agent";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);
setSourceOrigin("sync");
registerAgentFlowActions();

const commaSeparated = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
const queues = commaSeparated(process.env.TACHY_WORKER_QUEUES);
for (const queue of queues)
  if (!JOB_QUEUE_NAMES.includes(queue as never))
    throw new Error(`TACHY_WORKER_QUEUES: unknown queue '${queue}'`);
function workerClasses(): string[] {
  if (process.env.TACHY_WORKER_CLASSES)
    return commaSeparated(process.env.TACHY_WORKER_CLASSES);
  if (queues.length) return [...new Set(queues.map((q) => jobQueue(q).class))];
  return ["light"];
}
const classes = workerClasses();
for (const resourceClass of classes)
  if (!(JOB_RESOURCE_CLASSES as readonly string[]).includes(resourceClass))
    throw new Error(`TACHY_WORKER_CLASSES: unknown class '${resourceClass}'`);
for (const queue of queues)
  if (!classes.includes(jobQueue(queue).class))
    throw new Error(
      `TACHY_WORKER_QUEUES: '${queue}' is a ${jobQueue(queue).class} queue, outside TACHY_WORKER_CLASSES`,
    );
const concurrency = Number(process.env.TACHY_WORKER_CONCURRENCY) || 1;
const drainMs = (Number(process.env.TACHY_DRAIN_SECONDS) || 120) * 1000;

await loadSettingsIntoEnv().catch(() => {});
const worker = await startJobProcess({
  classes,
  queues: queues.length ? queues : undefined,
  concurrency,
});

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
