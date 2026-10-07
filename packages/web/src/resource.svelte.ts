import { ApiError } from "./api";

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/**
 * The sequence guard out of `createResource`, for views that load by hand. Call
 * the returned function at the top of a load: the predicate it gives back is
 * false once a newer load has started, so a slow response cannot overwrite a
 * faster one that came after it.
 */
export function createSequence(): () => () => boolean {
  let seq = 0;
  return () => {
    const mine = ++seq;
    return () => mine === seq;
  };
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

  // A failed write is rethrown, never stored: `error` stays the load error
  // the list's error slot reports. Storing it too prints a rejected write's
  // message twice, once from the slot and once from whoever caught the throw.
  async function mutate(change: () => Promise<unknown>) {
    await change();
    await reload();
  }

  return {
    get data() {
      return data;
    },
    set data(value: T) {
      data = value;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    set error(value: string | null) {
      error = value;
    },
    reload,
    mutate,
  };
}

export type Resource<T> = ReturnType<typeof createResource<T>>;
