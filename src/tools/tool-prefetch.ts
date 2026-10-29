import type { Tool } from './tools.types';

const pendingToolLoads = new WeakMap<Tool, Promise<unknown>>();

/**
 * Start loading a tool before navigation needs it. The promise is shared so
 * hover, focus, and the router never issue duplicate requests for a chunk.
 */
export function prefetchTool(tool: Tool): void {
  if (pendingToolLoads.has(tool)) {
    return;
  }

  const load = tool.component().catch((error: unknown) => {
    // A prefetch is best effort. Navigation will retry the component load if
    // the network was unavailable while the pointer was over the link.
    pendingToolLoads.delete(tool);
    console.debug(`[router] Could not prefetch ${tool.path}.`, error);
  });
  pendingToolLoads.set(tool, load);
}
