const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const toolIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const externalPluginToolRouteRoot = '/extensions';

/** Build the host metadata route for a signed external tool declaration. */
export function getExternalPluginToolRoute(
  pluginId: string,
  version: string,
  contributionId: string,
): string {
  if (!pluginIdPattern.test(pluginId)) {
    throw new Error('The external plugin ID is invalid.');
  }
  if (!stableVersionPattern.test(version)) {
    throw new Error('The external plugin version is invalid.');
  }

  const namespace = `${pluginId}/`;
  if (!contributionId.startsWith(namespace)) {
    throw new Error('The external tool contribution is outside its plugin namespace.');
  }
  const toolId = contributionId.slice(namespace.length);
  if (!toolIdPattern.test(toolId)) {
    throw new Error('The external tool contribution ID is invalid.');
  }

  return [
    externalPluginToolRouteRoot,
    encodeURIComponent(pluginId),
    encodeURIComponent(version),
    encodeURIComponent(toolId),
  ].join('/');
}
