import type { Component } from 'vue';
import { describe, expect, it } from 'vitest';
import { validateExternalPluginV2Manifest, type ExternalPluginV2Manifest } from '@/shared/external-plugin-v2';
import type { PluginToolCommandRequest } from '@/shared/plugin-tool-workbench';
import { projectExternalPluginV2Manifest } from './external-plugin-v2-tools';
import { ExternalPluginV2Registry } from './external-plugin-v2-registry';

const pluginId = 'org.example.registry-demo';

function createProjection(id = pluginId) {
  const manifest: ExternalPluginV2Manifest = validateExternalPluginV2Manifest({
    formatVersion: 2,
    id,
    name: 'Registry demo',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: [],
    activationEvents: [
      `onTool:${id}/tool`,
      `onCommand:${id}/run`,
    ],
    contributions: {
      tools: [{
        id: `${id}/tool`,
        title: 'Registry tool',
        description: 'A host-rendered registry tool.',
        keywords: ['registry'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
        inputs: [{ kind: 'text', id: 'value', label: 'Value' }],
        output: { kind: 'text' },
      }],
      commands: [{
        id: `${id}/run`,
        title: 'Run registry tool',
        description: 'Open the registry tool.',
        keywords: ['registry', 'run'],
        toolId: `${id}/tool`,
      }],
    },
  });
  return projectExternalPluginV2Manifest(manifest, {
    component: async () => ({} as Component),
    icon: {} as Component,
  });
}

describe('external plugin v2 runtime registry', () => {
  it('publishes one source for navigation, command search, and the host workbench', async () => {
    const registry = new ExternalPluginV2Registry();
    const execute = async (request: PluginToolCommandRequest) => ({ kind: 'text' as const, value: String(request.input.value) });
    const projection = createProjection();

    registry.register(projection, execute);

    expect(registry.tools.value.map(tool => tool.path)).toEqual([
      '/extensions/org.example.registry-demo/1.0.0/tool',
    ]);
    expect(registry.commands.value.map(command => command.id)).toEqual([
      'org.example.registry-demo/run',
    ]);
    const routeRegistration = registry.findByRoute('/extensions/org.example.registry-demo/1.0.0/tool');
    expect(routeRegistration?.workbench.commandId).toBe('org.example.registry-demo/run');
    await expect(routeRegistration?.execute({
      pluginId,
      version: '1.0.0',
      toolId: `${pluginId}/tool`,
      commandId: `${pluginId}/run`,
      input: { value: 'ok' },
    }, new AbortController().signal)).resolves.toEqual({ kind: 'text', value: 'ok' });
  });

  it('removes all indexes when the package is unregistered', () => {
    const registry = new ExternalPluginV2Registry();
    const projection = createProjection();
    registry.register(projection, async () => ({ kind: 'text', value: 'ok' }));

    registry.unregister(pluginId, '1.0.0');

    expect(registry.tools.value).toEqual([]);
    expect(registry.commands.value).toEqual([]);
    expect(registry.findByRoute('/extensions/org.example.registry-demo/1.0.0/tool')).toBeUndefined();
  });

  it('rejects a route or command collision between packages', () => {
    const registry = new ExternalPluginV2Registry();
    const projection = createProjection();
    registry.register(projection, async () => ({ kind: 'text', value: 'ok' }));

    const otherProjection = createProjection('org.example.other-demo');
    const duplicateCommandProjection = {
      ...otherProjection,
      registrations: otherProjection.registrations.map(registration => ({
        ...registration,
        workbench: { ...registration.workbench, commandId: `${pluginId}/run` },
      })),
      commands: otherProjection.commands.map(command => ({
        ...command,
        id: `${pluginId}/run`,
      })),
    };
    expect(() => registry.register(duplicateCommandProjection, async () => ({ kind: 'text', value: 'duplicate' })))
      .toThrow(/conflicts/);
  });
});
