import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import type { Tool } from './tools.types';
import { cancelToolPrefetch, prefetchTool, queueToolPrefetch } from './tool-prefetch';

function makeTool(component: () => Promise<Component>): Tool {
  return {
    name: 'Test tool',
    path: '/test-tool',
    translationKey: 'test-tool',
    description: 'Test tool',
    keywords: [],
    component,
    icon: {} as Component,
    isNew: false,
  };
}

describe('tool route prefetching', () => {
  it('waits for pointer intent and shares the resulting load', async () => {
    vi.useFakeTimers();
    const component = vi.fn(async () => ({}) as Component);
    const tool = makeTool(component);

    queueToolPrefetch(tool);
    vi.advanceTimersByTime(119);
    expect(component).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    prefetchTool(tool);
    expect(component).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('cancels a pointer prefetch when the pointer leaves quickly', () => {
    vi.useFakeTimers();
    const component = vi.fn(async () => ({}) as Component);
    const tool = makeTool(component);

    queueToolPrefetch(tool);
    cancelToolPrefetch(tool);
    vi.advanceTimersByTime(200);

    expect(component).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
