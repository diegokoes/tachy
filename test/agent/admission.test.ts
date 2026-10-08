import { describe, expect, it } from "vitest";
import {
  Admission,
  AdmissionCancelled,
  QueueFull,
} from "../../packages/api/src/admission";

describe("Admission", () => {
  it("admits up to the cap, queues in order, and grants as slots free", async () => {
    const admission = new Admission(() => ({ cap: 2, queueMax: 5 }));
    const first = admission.admit(1);
    const second = admission.admit(1);
    expect([first.position, second.position]).toEqual([0, 0]);

    const third = admission.admit(1);
    const fourth = admission.admit(1);
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
    expect(admission.stats).toMatchObject({ slotsUsed: 2, queued: 0 });
  });

  it("weighs a heavy turn by its slots, clamped to the cap", async () => {
    const admission = new Admission(() => ({ cap: 4, queueMax: 5 }));
    const heavy = admission.admit(4);
    expect(heavy.position).toBe(0);
    const light = admission.admit(1);
    expect(light.position).toBe(1);
    heavy.release();
    await light.granted;

    const huge = new Admission(() => ({ cap: 3, queueMax: 0 })).admit(10);
    expect(huge.position).toBe(0);
  });

  it("refuses past the queue and counts the refusal", () => {
    const admission = new Admission(() => ({ cap: 1, queueMax: 1 }));
    admission.admit(1);
    admission.admit(1);
    expect(() => admission.admit(1)).toThrow(QueueFull);
    expect(admission.stats.rejectedSinceBoot).toBe(1);
  });

  it("cancels a queued ticket without granting it or leaking a slot", async () => {
    const admission = new Admission(() => ({ cap: 1, queueMax: 5 }));
    const running = admission.admit(1);
    const queued = admission.admit(1);
    queued.release();
    await expect(queued.granted).rejects.toThrow(AdmissionCancelled);
    running.release();
    running.release();
    expect(admission.stats).toMatchObject({ slotsUsed: 0, queued: 0 });
  });
});
