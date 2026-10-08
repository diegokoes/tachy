import { describe, expect, it } from "vitest";
import {
  cpuBudget,
  embedThreads,
  parseCpuList,
  parseCpuMax,
} from "@tachy/core/search";

describe("parseCpuMax", () => {
  it("reads a quota as CPUs, and no quota as none", () => {
    expect(parseCpuMax("600000 100000\n")).toBe(6);
    expect(parseCpuMax("50000 100000")).toBe(0.5);
    expect(parseCpuMax("max 100000")).toBeUndefined();
    expect(parseCpuMax("")).toBeUndefined();
  });
});

describe("parseCpuList", () => {
  it("expands ranges and single CPUs", () => {
    expect([...parseCpuList("0-3,12,14-15\n")]).toEqual([
      0, 1, 2, 3, 12, 14, 15,
    ]);
    expect(parseCpuList("").size).toBe(0);
  });
});

describe("embedThreads", () => {
  it("follows a quota that is below the host's cores", () => {
    expect(embedThreads({ hostCores: 14, cores: 14, quota: 6 }, "")).toBe(6);
    expect(embedThreads({ hostCores: 14, cores: 14, quota: 2.5 }, "")).toBe(2);
  });

  it("never asks for less than one thread", () => {
    expect(embedThreads({ hostCores: 4, cores: 4, quota: 0.5 }, "")).toBe(1);
  });

  it("follows a CPU mask, counted in cores, and the smaller of mask and quota", () => {
    expect(embedThreads({ hostCores: 14, cores: 3 }, "")).toBe(3);
    expect(embedThreads({ hostCores: 14, cores: 4, quota: 6 }, "")).toBe(4);
    expect(embedThreads({ hostCores: 14, cores: 8, quota: 6 }, "")).toBe(6);
  });

  // The laptop: 4 cores, 8 logical CPUs, the embedder limited to 6. The
  // runtime's own 4 threads already fit.
  it("leaves the runtime its default when the limit is not below the cores", () => {
    expect(
      embedThreads({ hostCores: 4, cores: 4, quota: 6 }, ""),
    ).toBeUndefined();
    expect(
      embedThreads({ hostCores: 14, cores: 14 }, undefined),
    ).toBeUndefined();
  });

  it("takes TACHY_EMBED_THREADS over what it would work out", () => {
    expect(embedThreads({ hostCores: 14, cores: 14, quota: 6 }, "3")).toBe(3);
    expect(embedThreads({ hostCores: 4, cores: 4 }, "8")).toBe(8);
  });

  it("refuses a thread count that is not a whole number above zero", () => {
    for (const bad of ["0", "-2", "1.5", "many"])
      expect(() => embedThreads({ hostCores: 4, cores: 4 }, bad)).toThrow(
        /TACHY_EMBED_THREADS/,
      );
  });
});

describe("cpuBudget", () => {
  it("reports this host, with no more cores to run on than it has", () => {
    const budget = cpuBudget();
    expect(budget.hostCores).toBeGreaterThanOrEqual(1);
    expect(budget.cores).toBeGreaterThanOrEqual(1);
    expect(budget.cores).toBeLessThanOrEqual(budget.hostCores);
    expect(budget.quota === undefined || budget.quota > 0).toBe(true);
  });
});
