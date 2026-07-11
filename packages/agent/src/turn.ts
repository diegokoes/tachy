import { AsyncQueue } from "./queue";
import type { AgentEvent, AgentTurn, Decision } from "./backend";

export type ApprovalGate = (
  id: string,
  tool: string,
  input: unknown,
) => Promise<Decision>;

export abstract class TurnBase implements AgentTurn {
  protected q = new AsyncQueue<AgentEvent>();
  private pending = new Map<string, (d: Decision) => void>();

  events(): AsyncGenerator<AgentEvent> {
    return this.q.iterator();
  }

  approve(id: string, decision: Decision): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve(decision);
    }
  }

  protected requestApproval: ApprovalGate = async (id, tool, input) => {
    const decision = await new Promise<Decision>((resolve) => {
      this.pending.set(id, resolve);
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
    for (const [, resolve] of this.pending)
      resolve({ approve: false, message: "Turn ended." });
    this.pending.clear();
  }

  protected finish(): void {
    this.settlePending();
    this.q.close();
  }
}
