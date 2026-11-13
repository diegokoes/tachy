import { badInput } from "@tachy/core/infra";
import { AsyncQueue } from "./queue";
import type { AgentEvent, AgentTurn, Decision } from "./backend";

export type ApprovalGate = (
  id: string,
  tool: string,
  input: unknown,
) => Promise<Decision>;

const DEFAULT_APPROVAL_TIMEOUT_MS = 15 * 60_000;

/** Read by the model, which takes any other denial for the person declining. */
const APPROVAL_TIMED_OUT =
  "No one answered the review box in time, so nothing ran. This is not a refusal: say that it timed out and stop, without calling the tool again.";

function approvalTimeoutMs(): number {
  const configured = Number(process.env.TACHY_APPROVAL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_APPROVAL_TIMEOUT_MS;
}

export abstract class TurnBase implements AgentTurn {
  protected queue = new AsyncQueue<AgentEvent>();
  private pending = new Map<
    string,
    { resolve: (decision: Decision) => void; at: number; tool: string }
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
    return this.queue.iterator();
  }

  async approve(id: string, decision: Decision): Promise<void> {
    const entry = this.pending.get(id);
    if (!entry) return;
    const problem =
      decision.approve && decision.updatedInput
        ? await this.editProblem(entry.tool, decision.updatedInput)
        : null;
    if (problem) throw badInput(`the edited input does not fit: ${problem}`);
    // Answered or timed out while the edit was checked.
    if (this.pending.get(id) !== entry) return;
    this.pending.delete(id);
    entry.resolve(decision);
  }

  /** Why `tool` would refuse the input a person approved, or null. */
  protected async editProblem(
    _tool: string,
    _input: unknown,
  ): Promise<string | null> {
    return null;
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
        resolve({ approve: false, message: APPROVAL_TIMED_OUT });
      }, approvalTimeoutMs());
      timer.unref?.();
      this.pending.set(id, {
        resolve: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
        at: Date.now(),
        tool,
      });
      this.queue.push({ type: "approval_request", tool, input, id });
    });
    this.queue.push({
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
    this.queue.close();
  }
}
