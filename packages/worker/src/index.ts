import {
  JOB_QUEUE_NAMES,
  JOB_RESOURCE_CLASSES,
  jobQueue,
  backgroundSettled,
  loadSettingsIntoEnv,
  log,
  registerSource,
  setSourceOrigin,
  sql,
  startJobProcess,
} from "@tachy/core";
import { registerAgentFlowActions } from "@tachy/agent";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);
setSourceOrigin("sync");
registerAgentFlowActions();

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
const queues = list(process.env.TACHY_WORKER_QUEUES);
for (const q of queues)
  if (!JOB_QUEUE_NAMES.includes(q as never))
    throw new Error(`TACHY_WORKER_QUEUES: unknown queue '${q}'`);
const classes = process.env.TACHY_WORKER_CLASSES
  ? list(process.env.TACHY_WORKER_CLASSES)
  : queues.length
    ? [...new Set(queues.map((q) => jobQueue(q).class))]
    : ["light"];
for (const c of classes)
  if (!(JOB_RESOURCE_CLASSES as readonly string[]).includes(c))
    throw new Error(`TACHY_WORKER_CLASSES: unknown class '${c}'`);
for (const q of queues)
  if (!classes.includes(jobQueue(q).class))
    throw new Error(
      `TACHY_WORKER_QUEUES: '${q}' is a ${jobQueue(q).class} queue, outside TACHY_WORKER_CLASSES`,
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
