/**
 * Serialize asynchronous refreshes while preserving a later request that arrives during a run.
 * The returned promise resolves after the queued refresh has also completed.
 */
export function createQueuedRefresh(load: () => Promise<void>): () => Promise<void> {
  let active: Promise<void> | undefined;
  let queued = false;

  return () => {
    if (active) {
      queued = true;
      return active;
    }

    active = (async () => {
      do {
        queued = false;
        await load();
      } while (queued);
    })().finally(() => {
      active = undefined;
    });
    return active;
  };
}
