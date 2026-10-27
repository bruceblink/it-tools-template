import { describe, expect, it, vi } from 'vitest';
import { createQueuedRefresh } from './queued-refresh';

describe('queued async refresh', () => {
  it('runs one follow-up refresh when an event arrives during an active request', async () => {
    let resolveFirst: (() => void) | undefined;
    const firstRequest = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const load = vi.fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce(undefined);
    const refresh = createQueuedRefresh(load);

    const first = refresh();
    const queued = refresh();
    expect(load).toHaveBeenCalledOnce();

    resolveFirst?.();
    await Promise.all([first, queued]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('allows a later refresh after a failed request', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    const refresh = createQueuedRefresh(load);

    await expect(refresh()).rejects.toThrow('temporary failure');
    await expect(refresh()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
