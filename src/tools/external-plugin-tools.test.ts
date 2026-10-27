import { describe, expect, it } from 'vitest';
import {
  isExternalPluginToolContributionTrusted,
  selectExternalPluginSnapshots,
} from './external-plugin-tools';

function snapshot(pluginId: string, version: string, status: 'installed' | 'active' | 'invalid') {
  return { pluginId, version, status } as const;
}

describe('external plugin tool snapshot selection', () => {
  it('prefers the active version over a newer rollback version', () => {
    const selected = selectExternalPluginSnapshots([
      snapshot('org.example.demo', '1.0.0', 'active'),
      snapshot('org.example.demo', '2.0.0', 'installed'),
    ]);

    expect(selected).toEqual([snapshot('org.example.demo', '1.0.0', 'active')]);
  });

  it('uses the highest installed version when no version is active', () => {
    const selected = selectExternalPluginSnapshots([
      snapshot('org.example.demo', '1.0.0', 'installed'),
      snapshot('org.example.demo', '1.10.0', 'installed'),
      snapshot('org.example.demo', '1.2.0', 'installed'),
      snapshot('org.example.invalid', '1.0.0', 'invalid'),
    ]);

    expect(selected).toEqual([snapshot('org.example.demo', '1.10.0', 'installed')]);
  });

  it('keeps one deterministic selection for each valid plugin', () => {
    const selected = selectExternalPluginSnapshots([
      snapshot('org.zeta.demo', '1.0.0', 'installed'),
      snapshot('org.alpha.demo', '1.0.0', 'installed'),
      snapshot('org.zeta.demo', '1.1.0', 'installed'),
    ]);

    expect(selected.map(item => `${item.pluginId}@${item.version}`)).toEqual([
      'org.alpha.demo@1.0.0',
      'org.zeta.demo@1.1.0',
    ]);
  });
});

describe('external plugin tool contribution validation', () => {
  const plugin = { pluginId: 'org.example.demo', version: '1.2.3' } as const;
  const contribution = {
    id: 'org.example.demo/example-tool',
    title: 'Example tool',
    description: 'A signed example tool.',
    keywords: ['example'],
    route: '/extensions/org.example.demo/1.2.3/example-tool',
    dataProcessing: 'memory-only' as const,
    offline: 'available' as const,
    capabilities: ['runtime.info' as const],
  };

  it('accepts only the route reconstructed from the signed package identity', () => {
    expect(isExternalPluginToolContributionTrusted(plugin, contribution)).toBe(true);
  });

  it.each([
    ['host route was replaced', { route: '/settings' }],
    ['contribution escaped its namespace', { id: 'org.other.example-tool' }],
    ['unknown capability was injected', { capabilities: ['file.delete'] }],
    ['duplicate capability was injected', { capabilities: ['runtime.info', 'runtime.info'] }],
    ['governance metadata was removed', { dataProcessing: undefined }],
  ])('rejects %s', (_name, change) => {
    expect(isExternalPluginToolContributionTrusted(plugin, { ...contribution, ...change })).toBe(false);
  });
});
