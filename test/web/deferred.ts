/**
 * A promise the test settles by hand. `Promise.withResolvers` is ES2024, past
 * the `lib` the SPA and these tests are checked against.
 */
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
