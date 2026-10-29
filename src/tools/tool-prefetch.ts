import type { Tool } from './tools.types';

const pendingLoads = new WeakMap<Tool, Promise<unknown>>();
const queuedLoads = new WeakMap<Tool, ReturnType<typeof setTimeout>>();

/** Start loading one tool once the user has shown intent to open it. */
export function prefetchTool(tool: Tool): void {
  if (pendingLoads.has(tool)) {
    return;
  }

  const load = tool.component().catch((error: unknown) => {
    pendingLoads.delete(tool);
    console.debug(`[router] Could not prefetch ${tool.path}.`, error);
  });
  pendingLoads.set(tool, load);
}

/** Avoid starting requests while the pointer is merely moving across the grid. */
export function queueToolPrefetch(tool: Tool): void {
  if (pendingLoads.has(tool) || queuedLoads.has(tool)) {
    return;
  }
  queuedLoads.set(tool, setTimeout(() => {
    queuedLoads.delete(tool);
    prefetchTool(tool);
  }, 120));
}

export function cancelToolPrefetch(tool: Tool): void {
  const timer = queuedLoads.get(tool);
  if (timer !== undefined) {
    clearTimeout(timer);
    queuedLoads.delete(tool);
  }
}
