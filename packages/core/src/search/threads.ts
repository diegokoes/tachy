import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

/** What bounds the CPU this process may use. */
export interface CpuBudget {
  /** Physical cores of the host, which is what the ONNX runtime counts. */
  hostCores: number;
  /** Physical cores this process may run on. A CPU mask makes them fewer. */
  cores: number;
  /** The cgroup's quota in CPUs, when it has one: Compose's `cpus`. */
  quota?: number;
}

/** `cpu.max` reads "<quota> <period>" in microseconds, or "max <period>". */
export function parseCpuMax(text: string): number | undefined {
  const [quota, period] = text.trim().split(/\s+/).map(Number);
  return quota > 0 && period > 0 ? quota / period : undefined;
}

/** A kernel CPU list, "0-7,12". */
export function parseCpuList(text: string): Set<number> {
  const cpus = new Set<number>();
  for (const part of text.trim().split(",")) {
    if (!part) continue;
    const [first, last = first] = part.split("-").map(Number);
    for (let n = first; n <= last; n++) cpus.add(n);
  }
  return cpus;
}

const CPU_DIR = "/sys/devices/system/cpu";

function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Hyperthreads of one core share a `thread_siblings_list`. */
function linuxCores(): { host: number; usable: number } | undefined {
  let entries: string[];
  try {
    entries = readdirSync(CPU_DIR);
  } catch {
    return undefined;
  }
  const mask = /Cpus_allowed_list:\s*(\S+)/.exec(
    read("/proc/self/status") ?? "",
  )?.[1];
  const allowed = mask ? parseCpuList(mask) : undefined;
  const host = new Set<string>();
  const usable = new Set<string>();
  for (const entry of entries) {
    const cpu = /^cpu(\d+)$/.exec(entry)?.[1];
    const core =
      cpu && read(`${CPU_DIR}/${entry}/topology/thread_siblings_list`)?.trim();
    if (!core) continue;
    host.add(core);
    if (!allowed || allowed.has(Number(cpu))) usable.add(core);
  }
  return host.size
    ? { host: host.size, usable: usable.size || host.size }
    : undefined;
}

export function cpuBudget(): CpuBudget {
  const cores = linuxCores();
  const cpuMax = read("/sys/fs/cgroup/cpu.max");
  return {
    hostCores: cores?.host ?? os.cpus().length,
    cores: cores?.usable ?? os.availableParallelism(),
    quota: cpuMax === undefined ? undefined : parseCpuMax(cpuMax),
  };
}

/**
 * Threads the ONNX runtime computes with, or undefined to leave its default:
 * one per physical core of the host, pinned, whatever CPU limit the container
 * has (https://onnxruntime.ai/docs/performance/tune-performance/threading.html).
 * Under a smaller limit those threads queue for the same CPUs, so the count
 * follows the limit. `TACHY_EMBED_THREADS` sets it outright.
 */
export function embedThreads(
  budget: CpuBudget = cpuBudget(),
  asked: string | undefined = process.env.TACHY_EMBED_THREADS,
): number | undefined {
  if (asked) {
    const fixed = Number(asked);
    if (!Number.isInteger(fixed) || fixed < 1)
      throw new Error(
        `TACHY_EMBED_THREADS must be a whole number of threads, got '${asked}'`,
      );
    return fixed;
  }
  const usable = Math.min(budget.cores, Math.floor(budget.quota ?? Infinity));
  return usable < budget.hostCores ? Math.max(1, usable) : undefined;
}
