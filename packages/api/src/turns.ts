import type { AgentTurn } from "@tachy/agent";
import { JOB_CLASS_CHAT_SLOTS } from "@tachy/core";
import { runningHeavyJobs } from "@tachy/core/jobs";
import { Admission, type AdmissionLimits } from "./admission";

/** A chat turn this process is running, and who it belongs to. */
export interface TurnEntry {
  turn: AgentTurn;
  email?: string;
  startedAt: number;
  leave: () => void;
}

const TURN_TTL_MS = 60 * 60_000;

/** Turn id → the turn, while it runs or waits for an approval. */
export const turns = new Map<string, TurnEntry>();

/** User key → the turn that user has running or waiting, at most one. */
export const activeByUser = new Map<string, string>();

/** Turns still waiting for a slot, so /stop can take them out of the queue. */
export const waiting = new Map<string, { email?: string; leave: () => void }>();

let limits: AdmissionLimits = { cap: 15, queueMax: 10 };
/** Chat slots held by heavy jobs running now, in any process. */
let jobSlots = 0;

export const admission = new Admission(() => ({
  ...limits,
  cap: Math.max(1, limits.cap - jobSlots),
}));

export const setAdmissionLimits = (next: AdmissionLimits) => (limits = next);

export function turnStats() {
  let running = 0;
  let pendingApprovals = 0;
  let oldestApprovalAt: number | null = null;
  for (const { turn } of turns.values()) {
    if (turn.finished) continue;
    running++;
    pendingApprovals += turn.pendingApprovals;
    const at = turn.oldestPendingApprovalAt;
    if (at !== null && (oldestApprovalAt === null || at < oldestApprovalAt))
      oldestApprovalAt = at;
  }
  return {
    ...admission.stats,
    running,
    pendingApprovals,
    oldestApprovalAgeSeconds:
      oldestApprovalAt === null
        ? null
        : Math.round((Date.now() - oldestApprovalAt) / 1000),
  };
}

export const activeTurnCount = () =>
  [...turns.values()].filter((e) => !e.turn.finished).length;

export function abortAllTurns(): number {
  let aborted = 0;
  for (const entry of turns.values())
    if (!entry.turn.finished) {
      entry.turn.abort();
      aborted++;
    }
  return aborted;
}

/**
 * A dropped SSE stream must not orphan a running turn: entries stay approvable
 * until the turn finishes on its own (approvals time out in the agent layer),
 * and this reaps anything that outlives the TTL.
 */
function sweepTurns() {
  const now = Date.now();
  for (const [id, entry] of turns) {
    if (entry.turn.finished) {
      turns.delete(id);
      entry.leave();
    } else if (now - entry.startedAt > TURN_TTL_MS) {
      entry.turn.abort();
      turns.delete(id);
      entry.leave();
    }
  }
}

function pollJobSlots() {
  runningHeavyJobs()
    .then((n) => (jobSlots = n * JOB_CLASS_CHAT_SLOTS.heavy))
    .catch(() => {});
}

/** Start the turn sweep and the heavy-job poll. Returns what stops them. */
export function startTurnHousekeeping(): () => void {
  const timers = [
    setInterval(sweepTurns, 60_000),
    setInterval(pollJobSlots, 10_000),
  ];
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
