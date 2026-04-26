import { describe, expect, it } from 'vitest';
import { useToolState } from './useToolState';

describe('useToolState', () => {
  it('initializes with idle state', () => {
    const { isLoading, errorMessage, result } = useToolState();
    expect(isLoading.value).toBe(false);
    expect(errorMessage.value).toBe(null);
    expect(result.value).toBe(null);
  });

  it('sets result on successful run', async () => {
    const { isLoading, errorMessage, result, run } = useToolState<number>();
    await run(() => 42);
    expect(result.value).toBe(42);
    expect(errorMessage.value).toBe(null);
    expect(isLoading.value).toBe(false);
  });

  it('captures error message on failure', async () => {
    const { errorMessage, result, run } = useToolState<number>();
    await run(() => { throw new Error('something went wrong'); });
    expect(errorMessage.value).toBe('something went wrong');
    expect(result.value).toBe(null);
  });

  it('handles async functions', async () => {
    const { result, run } = useToolState<string>();
    await run(async () => {
      await Promise.resolve();
      return 'async result';
    });
    expect(result.value).toBe('async result');
  });

  it('resets all state', async () => {
    const { result, errorMessage, run, reset } = useToolState<number>();
    await run(() => 1);
    reset();
    expect(result.value).toBe(null);
    expect(errorMessage.value).toBe(null);
  });

  it('converts non-Error throws to string', async () => {
    const { errorMessage, run } = useToolState();
    await run(() => { throw 'raw string error'; });
    expect(errorMessage.value).toBe('raw string error');
  });
});
