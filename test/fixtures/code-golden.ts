/**
 * Questions about tachý's own source, each with the file that answers it, for
 * measuring code search (scripts/eval-code-search.ts). The script says which
 * expected files the index no longer holds.
 *
 * `why` names the leg a question is meant to exercise:
 *
 * - identifier: a symbol exactly as written;
 * - words: the same symbols typed as words, which only a leg that splits
 *   camelCase and snake_case can match exactly;
 * - meaning: a description in other words than the code uses, which only the
 *   vector leg can find;
 * - path: a file or component asked for by name;
 * - tail: something that sits past the first 2000 characters of a large chunk.
 */
export type CodeQuestionKind =
  "identifier" | "words" | "meaning" | "path" | "tail";

export interface CodeQuestion {
  q: string;
  /** Any of these files counts as found. */
  expect: string[];
  why: CodeQuestionKind;
}

const q = (
  why: CodeQuestionKind,
  text: string,
  ...expect: string[]
): CodeQuestion => ({ q: text, expect, why });

export const CODE_GOLDEN: CodeQuestion[] = [
  q("identifier", "sweepInterruptedIndexes", "packages/core/src/code/repos.ts"),
  q("identifier", "WORD_SIM_THRESHOLD", "packages/core/src/search/rank.ts"),
  q("identifier", "inLoadWindow", "packages/core/src/diagnostics/load-runs.ts"),
  q("identifier", "claudeEnv", "packages/agent/src/claude.ts"),
  q("identifier", "bucketByToken", "packages/core/src/buckets/buckets.ts"),
  q("identifier", "scheduleDueRuns", "packages/core/src/jobs/scheduler.ts"),
  q("identifier", "estimateCostUsd", "packages/core/src/analytics/runs.ts"),
  q(
    "identifier",
    "TACHY_UPLOAD_TTL_HOURS",
    "packages/core/src/chat/uploads.ts",
  ),
  q("identifier", "assertRepoUrl", "packages/core/src/code/git.ts"),
  q("identifier", "notifyRunFinished", "packages/core/src/jobs/notify.ts"),

  q("words", "sweep interrupted indexes", "packages/core/src/code/repos.ts"),
  q("words", "word sim threshold", "packages/core/src/search/rank.ts"),
  q("words", "schedule due runs", "packages/core/src/jobs/scheduler.ts"),
  q("words", "estimate cost usd", "packages/core/src/analytics/runs.ts"),
  q("words", "bucket by token", "packages/core/src/buckets/buckets.ts"),
  q("words", "parse duration", "packages/contract/src/jobs.ts"),
  q("words", "resolve credential", "packages/core/src/config/credentials.ts"),
  q("words", "record tool call", "packages/core/src/analytics/tools.ts"),
  q("words", "empty session dir", "packages/api/src/turn-config.ts"),
  q("words", "validate graph", "packages/core/src/flows/graph.ts"),

  q(
    "meaning",
    "where is the limit on concurrent chat turns enforced",
    "packages/api/src/admission.ts",
    "packages/api/src/turns.ts",
    "packages/api/src/routes/agent.ts",
  ),
  q(
    "meaning",
    "how source files are cut into pieces before embedding",
    "packages/core/src/code/chunk-code.ts",
  ),
  q(
    "meaning",
    "combining vector, keyword and fuzzy rankings into one order",
    "packages/core/src/search/rank.ts",
  ),
  q(
    "meaning",
    "graceful shutdown waits for running chats before exiting",
    "packages/api/src/index.ts",
  ),
  q(
    "meaning",
    "a worker takes the next queued job without two workers taking the same one",
    "packages/core/src/jobs/runs.ts",
  ),
  q(
    "meaning",
    "hide emails and phone numbers in text before the model sees it",
    "packages/core/src/compliance/redaction.ts",
  ),
  q(
    "meaning",
    "block repeated failed sign-in attempts",
    "packages/api/src/auth.ts",
  ),
  q(
    "meaning",
    "encrypting stored tokens with the master key",
    "packages/core/src/infra/secrets.ts",
  ),
  q(
    "meaning",
    "decide whether an agent tool call needs the user's approval",
    "packages/agent/src/tools.ts",
    "packages/agent/src/claude.ts",
  ),
  q(
    "meaning",
    "delete old chat session files after ninety days",
    "packages/core/src/compliance/retention.ts",
  ),
  q(
    "meaning",
    "endpoint that receives documents pushed by an external script",
    "packages/api/src/routes/ingest.ts",
  ),
  q(
    "meaning",
    "a search waits behind at most one batch of documents being embedded",
    "packages/core/src/search/embed-queue.ts",
  ),
  q(
    "meaning",
    "health check that the database schema matches the image",
    "packages/api/src/lifecycle.ts",
    "packages/core/src/infra/schema-stamp.ts",
  ),
  q(
    "meaning",
    "post a message to Teams when a job fails",
    "packages/core/src/jobs/notify.ts",
  ),
  q(
    "meaning",
    "turn a similarity score into strong, good or weak",
    "packages/core/src/search/relevance.ts",
    "packages/contract/src/relevance.ts",
  ),
  q(
    "meaning",
    "fill in placeholders like item title in a flow step's parameters",
    "packages/contract/src/flows.ts",
    "packages/core/src/flows/run.ts",
  ),
  q(
    "meaning",
    "which model credential a chat uses: the user's own, the team's or the global one",
    "packages/core/src/config/credentials.ts",
  ),
  q(
    "meaning",
    "stand-in for the Anthropic API used in load tests",
    "load/mock-llm/server.mjs",
  ),
  q(
    "meaning",
    "roll per-person usage rows up into monthly totals",
    "packages/core/src/compliance/retention.ts",
  ),
  q(
    "meaning",
    "only the person who attached a file can read it back",
    "packages/core/src/chat/uploads.ts",
  ),

  q("path", "FlowCanvas", "packages/web/src/flows/FlowCanvas.svelte"),
  q(
    "path",
    "issues modal on the admin overview",
    "packages/web/src/admin/IssuesModal.svelte",
  ),
  q(
    "path",
    "schedule preview component",
    "packages/web/src/jobs/SchedulePreview.svelte",
  ),
  q("path", "setup wizard", "packages/web/src/access/SetupWizard.svelte"),
  q("path", "mock llm server", "load/mock-llm/server.mjs"),
];
