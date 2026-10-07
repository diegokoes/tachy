export class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    let resolver: ((result: IteratorResult<T>) => void) | undefined;
    while ((resolver = this.resolvers.shift()))
      resolver({ value: undefined as never, done: true });
  }

  async *iterator(): AsyncGenerator<T> {
    for (;;) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) =>
        this.resolvers.push(resolve),
      );
      if (next.done) return;
      yield next.value;
    }
  }
}
