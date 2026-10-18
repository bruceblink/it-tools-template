import { extensionHost } from './runtime';
import { firstPartyExtensionToolCategories } from './samples/tool-definitions';

/** Activate the package that owns a route after the route-specific module is loaded. */
export async function activateExtensionToolRoute(path: string): Promise<void> {
  const tool = firstPartyExtensionToolCategories
    .flatMap(({ components }) => components)
    .find(candidate => candidate.path === path);
  if (!tool || typeof tool.id !== 'string') {
    return;
  }
  const separator = tool.id.lastIndexOf('/');
  if (separator < 1) {
    throw new Error(`Registered extension tool ${tool.id} has an invalid package namespace.`);
  }
  await extensionHost.activate(tool.id.slice(0, separator), `onTool:${tool.id}`);
}
