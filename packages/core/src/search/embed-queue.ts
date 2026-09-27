export type EmbedKind = "query" | "passage";
/** Low-priority passages (background jobs) wait until no normal passage does. */
export type EmbedPriority = "normal" | "low";

/** Runs one batch of already-prepared texts through the model. */
export type EmbedRunner = (texts: string[]) => Promise<number[][]>;

interface Job {
  texts: string[];
  order: number[];
  next: number;
  out: number[][];
  resolve: (vectors: number[][]) => void;
  reject: (err: unknown) => void;
}

export interface EmbedQueueDepth {
  queries: number;
  passages: number;
  callers: number;
  running: boolean;
}

/**
 * One model, one batch at a time. Queries always go first, so a search waits
 * behind at most the passage batch already running. Passages go in small
 * batches, one batch per caller in turn, so a large reference save cannot hold
 * up another turn's knowledge save until it has finished.
 */
export class EmbedQueue {
  private queries: Job[] = [];
  private passages = new Map<string, Job[]>();
  private rotation: string[] = [];
  private lowRotation: string[] = [];
  private running = false;

  constructor(
    private readonly run: EmbedRunner,
    private readonly opts = { passageBatch: 8, queryBatch: 32 },
  ) {}

  embed(
    kind: EmbedKind,
    texts: string[],
    caller = "local",
    priority: EmbedPriority = "normal",
  ): Promise<number[][]> {
    if (!texts.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const order = texts.map((_, i) => i);
      if (kind === "passage")
        order.sort((a, b) => texts[a].length - texts[b].length);
      const job: Job = {
        texts,
        order,
        next: 0,
        out: new Array(texts.length),
        resolve,
        reject,
      };
      if (kind === "query") this.queries.push(job);
      else {
        const key = `${priority}:${caller}`;
        const jobs = this.passages.get(key);
        if (jobs) jobs.push(job);
        else {
          this.passages.set(key, [job]);
          (priority === "low" ? this.lowRotation : this.rotation).push(key);
        }
      }
      this.pump();
    });
  }

  get depth(): EmbedQueueDepth {
    let passages = 0;
    for (const jobs of this.passages.values())
      for (const j of jobs) passages += j.texts.length - j.next;
    return {
      queries: this.queries.reduce((n, j) => n + j.texts.length, 0),
      passages,
      callers: this.rotation.length + this.lowRotation.length,
      running: this.running,
    };
  }

  private pump(): void {
    if (this.running) return;
    const step = this.queries.length
      ? this.runQueries()
      : this.rotation.length
        ? this.runPassages(this.rotation)
        : this.lowRotation.length
          ? this.runPassages(this.lowRotation)
          : undefined;
    if (!step) return;
    this.running = true;
    void step.finally(() => {
      this.running = false;
      this.pump();
    });
  }

  private async runQueries(): Promise<void> {
    const batch: Job[] = [];
    let size = 0;
    while (
      this.queries.length &&
      (batch.length === 0 ||
        size + this.queries[0].texts.length <= this.opts.queryBatch)
    ) {
      const job = this.queries.shift()!;
      batch.push(job);
      size += job.texts.length;
    }
    try {
      const vectors = await this.run(batch.flatMap((j) => j.texts));
      let at = 0;
      for (const job of batch) {
        job.resolve(vectors.slice(at, at + job.texts.length));
        at += job.texts.length;
      }
    } catch (err) {
      for (const job of batch) job.reject(err);
    }
  }

  private async runPassages(rotation: string[]): Promise<void> {
    const caller = rotation.shift()!;
    const jobs = this.passages.get(caller)!;
    const job = jobs[0];
    const idx = job.order.slice(job.next, job.next + this.opts.passageBatch);
    let failed = false;
    try {
      const vectors = await this.run(idx.map((i) => job.texts[i]));
      idx.forEach((i, k) => (job.out[i] = vectors[k]));
      job.next += idx.length;
    } catch (err) {
      failed = true;
      job.reject(err);
    }
    if (failed || job.next >= job.texts.length) {
      jobs.shift();
      if (!failed) job.resolve(job.out);
    }
    if (jobs.length) rotation.push(caller);
    else this.passages.delete(caller);
  }
}
