export interface AdmissionLimits {
  /** Slots all running turns may hold together. */
  cap: number;
  /** Turns allowed to wait for a slot; one more is refused outright. */
  queueMax: number;
}

export class QueueFull extends Error {
  constructor() {
    super("every chat slot is busy and the queue is full; try again shortly");
    this.name = "QueueFull";
  }
}

export class AdmissionCancelled extends Error {
  constructor() {
    super("stopped before it started");
    this.name = "AdmissionCancelled";
  }
}

interface Waiter {
  weight: number;
  grant: () => void;
  cancel: () => void;
}

export interface Ticket {
  /** Resolves once the turn holds its slots. */
  granted: Promise<void>;
  /** 0 when admitted straight away, otherwise 1-based place in the queue. */
  position: number;
  /**
   * Gives the slots back, or leaves the queue if never granted, in which case
   * `granted` rejects with AdmissionCancelled. Idempotent.
   */
  release: () => void;
}

/**
 * Chat turns are bounded by memory, not CPU: each is a CLI process and an MCP
 * child. Slots count that cost (a Copilot turn weighs more than a Claude one),
 * turns wait in arrival order, and past a short queue the caller is refused.
 */
export class Admission {
  private used = 0;
  private queue: Waiter[] = [];
  private rejected = 0;

  constructor(private readonly limits: () => AdmissionLimits) {}

  admit(weight: number): Ticket {
    const { cap, queueMax } = this.limits();
    const w = Math.max(1, Math.min(weight, cap));
    let held = false;
    let done = false;
    let waiter: Waiter | undefined;

    const release = () => {
      if (done) return;
      done = true;
      if (held) this.used -= w;
      else if (waiter) {
        this.queue.splice(this.queue.indexOf(waiter), 1);
        waiter.cancel();
      }
      this.pump();
    };

    if (this.queue.length === 0 && this.used + w <= cap) {
      this.used += w;
      held = true;
      return { granted: Promise.resolve(), position: 0, release };
    }
    if (this.queue.length >= queueMax) {
      this.rejected++;
      throw new QueueFull();
    }
    const granted = new Promise<void>((resolve, reject) => {
      waiter = {
        weight: w,
        grant: () => {
          held = true;
          resolve();
        },
        cancel: () => reject(new AdmissionCancelled()),
      };
    });
    granted.catch(() => {});
    this.queue.push(waiter!);
    return { granted, position: this.queue.length, release };
  }

  private pump(): void {
    const { cap } = this.limits();
    while (this.queue.length && this.used + this.queue[0].weight <= cap) {
      const next = this.queue.shift()!;
      this.used += next.weight;
      next.grant();
    }
  }

  get stats() {
    return {
      slotsUsed: this.used,
      slotCap: this.limits().cap,
      queued: this.queue.length,
      rejectedSinceBoot: this.rejected,
    };
  }
}
