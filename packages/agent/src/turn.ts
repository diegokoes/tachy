import { AsyncQueue } from "./queue";
import type { AgentEvent, AgentTurn, Decision } from "./backend";

export type ApprovalGate = (
  id: string,
  tool: string,
  input: unknown,
) => Promise<Decision>;

const APPROVAL_TIMEOUT_DEFAULT = 15 * 60_000;

function approvalTimeoutMs(): number {
  const v = Number(process.env.TACHY_APPROVAL_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : APPROVAL_TIMEOUT_DEFAULT;
}

export abstract class TurnBase implements AgentTurn {
  protected q = new AsyncQueue<AgentEvent>();
  private pending = new Map<
    string,
    { resolve: (d: Decision) => void; at: number }
  >();
  finished = false;

  get pendingApprovals(): number {
    return this.pending.size;
  }

  get oldestPendingApprovalAt(): number | null {
    let oldest: number | null = null;
    for (const { at } of this.pending.values())
      if (oldest === null || at < oldest) oldest = at;
    return oldest;
  }

  events(): AsyncGenerator<AgentEvent> {
    return this.q.iterator();
  }

  approve(id: string, decision: Decision): void {
    const entry = this.pending.get(id);
    if (entry) {
      this.pending.delete(id);
      entry.resolve(decision);
    }
  }

  abort(): void {
    this.onAbort();
    this.settlePending();
  }

  protected onAbort(): void {}

  protected requestApproval: ApprovalGate = async (id, tool, input) => {
    const decision = await new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ approve: false, message: "Approval timed out." });
      }, approvalTimeoutMs());
      timer.unref?.();
      this.pending.set(id, {
        resolve: (d) => {
          clearTimeout(timer);
          resolve(d);
        },
        at: Date.now(),
      });
      this.q.push({ type: "approval_request", tool, input, id });
    });
    this.q.push({
      type: "approval_resolved",
      id,
      approved: decision.approve,
    });
    return decision;
  };

  protected settlePending(): void {
    for (const { resolve } of this.pending.values())
      resolve({ approve: false, message: "Turn ended." });
    this.pending.clear();
  }

  protected finish(): void {
    this.settlePending();
    this.finished = true;
    this.q.close();
  }
}
