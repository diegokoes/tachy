import { ApiError } from "./api";

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/**
 * One load/loading/error/reload lifecycle, shared by every list view instead
 * of being hand-rolled per panel. `mutate` runs a write and reloads on success.
 */
export function createResource<T>(load: () => Promise<T>, initial: T) {
  let data = $state<T>(initial);
  // True until the first `reload` settles, so a list never paints its empty
  // state in the frame before the initial fetch is even started.
  let loading = $state(true);
  let error = $state<string | null>(null);
  let seq = 0;

  async function reload() {
    const mine = ++seq;
    loading = true;
    try {
      const next = await load();
      if (mine === seq) {
        data = next;
        error = null;
      }
    } catch (e) {
      if (mine === seq) error = errText(e);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  /* A failed write is rethrown, never stored: `error` stays the *load* error,
     which is what the list's own error slot reports. Storing it here too made
     a rejected delete print its message twice — once from the slot, once from
     whoever caught the throw. */
  async function mutate(fn: () => Promise<unknown>) {
    await fn();
    await reload();
  }

  return {
    get data() {
      return data;
    },
    set data(v: T) {
      data = v;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    set error(v: string | null) {
      error = v;
    },
    reload,
    mutate,
  };
}

export type Resource<T> = ReturnType<typeof createResource<T>>;
