import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import type { Tool } from './tools.types';
import { prefetchTool } from './tool-prefetch';

function createTool(component: () => Promise<Component>): Tool {
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

describe('prefetchTool', () => {
  it('shares a component request across repeated hover events', async () => {
    const component = vi.fn(async () => ({}) as Component);
    const tool = createTool(component);

    prefetchTool(tool);
    prefetchTool(tool);
    await Promise.resolve();

    expect(component).toHaveBeenCalledTimes(1);
  });

  it('allows a failed prefetch to retry later', async () => {
    const component = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({} as Component);
    const tool = createTool(component);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    prefetchTool(tool);
    await Promise.resolve();
    await Promise.resolve();
    prefetchTool(tool);
    await Promise.resolve();

    expect(component).toHaveBeenCalledTimes(2);
    debug.mockRestore();
  });
});
