// Minimal single-consumer async queue: producers push, one consumer iterates.
// Used to fan agent events (text, tool activity, approval requests) from the SDK
// control loop + canUseTool callback into one ordered stream the API route drains.
export class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const r = this.resolvers.shift();
    if (r) r({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    let r: ((r: IteratorResult<T>) => void) | undefined;
    while ((r = this.resolvers.shift())) r({ value: undefined as never, done: true });
  }

  async *iterator(): AsyncGenerator<T> {
    for (;;) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const res = await new Promise<IteratorResult<T>>((rs) => this.resolvers.push(rs));
      if (res.done) return;
      yield res.value;
    }
  }
}
