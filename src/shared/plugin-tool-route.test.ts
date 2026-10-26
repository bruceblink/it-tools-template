import { describe, expect, it } from 'vitest';
import { getExternalPluginToolRoute } from './plugin-tool-route';

describe('external plugin tool routes', () => {
  it('builds a stable route from a namespaced contribution', () => {
    expect(getExternalPluginToolRoute(
      'org.example.plugin',
      '1.2.3',
      'org.example.plugin/example-tool',
    )).toBe('/extensions/org.example.plugin/1.2.3/example-tool');
  });

  it.each([
    ['invalid plugin id', 'Org.Example', '1.0.0', 'Org.Example/tool'],
    ['invalid version', 'org.example.plugin', '1.0', 'org.example.plugin/tool'],
    ['foreign namespace', 'org.example.plugin', '1.0.0', 'org.other/tool'],
    ['unsafe tool id', 'org.example.plugin', '1.0.0', 'org.example.plugin/../tool'],
  ])('rejects %s', (_name, pluginId, version, contributionId) => {
    expect(() => getExternalPluginToolRoute(pluginId, version, contributionId)).toThrow();
  });
});
