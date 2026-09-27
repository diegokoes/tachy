import { describe, expect, it } from "vitest";
import {
  Admission,
  AdmissionCancelled,
  QueueFull,
} from "../packages/api/src/admission";

describe("Admission", () => {
  it("admits up to the cap, queues in order, and grants as slots free", async () => {
    const a = new Admission(() => ({ cap: 2, queueMax: 5 }));
    const first = a.admit(1);
    const second = a.admit(1);
    expect([first.position, second.position]).toEqual([0, 0]);

    const third = a.admit(1);
    const fourth = a.admit(1);
    expect([third.position, fourth.position]).toEqual([1, 2]);

    const order: string[] = [];
    void third.granted.then(() => order.push("third"));
    void fourth.granted.then(() => order.push("fourth"));
    first.release();
    await Promise.resolve();
    expect(order).toEqual(["third"]);
    second.release();
    await fourth.granted;
    expect(order).toEqual(["third", "fourth"]);
    expect(a.stats).toMatchObject({ slotsUsed: 2, queued: 0 });
  });

  it("weighs a heavy turn by its slots, clamped to the cap", async () => {
    const a = new Admission(() => ({ cap: 4, queueMax: 5 }));
    const copilot = a.admit(4);
    expect(copilot.position).toBe(0);
    const claude = a.admit(1);
    expect(claude.position).toBe(1);
    copilot.release();
    await claude.granted;

    const huge = new Admission(() => ({ cap: 3, queueMax: 0 })).admit(10);
    expect(huge.position).toBe(0);
  });

  it("refuses past the queue and counts the refusal", () => {
    const a = new Admission(() => ({ cap: 1, queueMax: 1 }));
    a.admit(1);
    a.admit(1);
    expect(() => a.admit(1)).toThrow(QueueFull);
    expect(a.stats.rejectedSinceBoot).toBe(1);
  });

  it("cancels a queued ticket without granting it or leaking a slot", async () => {
    const a = new Admission(() => ({ cap: 1, queueMax: 5 }));
    const running = a.admit(1);
    const queued = a.admit(1);
    queued.release();
    await expect(queued.granted).rejects.toThrow(AdmissionCancelled);
    running.release();
    running.release();
    expect(a.stats).toMatchObject({ slotsUsed: 0, queued: 0 });
  });
});
