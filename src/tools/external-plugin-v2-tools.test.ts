import type { Component } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ExternalPluginV2Manifest } from '@/shared/external-plugin-v2';
import { validateExternalPluginV2Manifest } from '@/shared/external-plugin-v2';
import { projectExternalPluginV2Manifest } from './external-plugin-v2-tools';

function createManifest(): ExternalPluginV2Manifest {
  return validateExternalPluginV2Manifest({
    formatVersion: 2,
    id: 'org.example.json-tools',
    name: 'JSON tools',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: [],
    activationEvents: [
      'onTool:org.example.json-tools/summary',
      'onCommand:org.example.json-tools/summarize',
    ],
    contributions: {
      tools: [{
        id: 'org.example.json-tools/summary',
        title: 'JSON summary',
        description: 'Summarize JSON input.',
        keywords: ['json', 'summary'],
        categoryId: 'data',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
        inputs: [{ kind: 'text', id: 'input', label: 'JSON input', multiline: true, required: true }],
        output: { kind: 'json' },
      }],
      commands: [{
        id: 'org.example.json-tools/summarize',
        title: 'Summarize JSON',
        description: 'Summarize JSON input.',
        keywords: ['json', 'summary'],
        toolId: 'org.example.json-tools/summary',
      }],
    },
  });
}

describe('external plugin v2 registry projection', () => {
  it('publishes host-rendered tools and static command index entries', () => {
    const component = async () => ({} as Component);
    const icon = {} as Component;
    const projection = projectExternalPluginV2Manifest(createManifest(), {
      component,
      icon,
      categoryNames: { data: 'Data' },
    });

    expect(projection.tools).toHaveLength(1);
    expect(projection.tools[0]).toMatchObject({
      id: 'external-v2/org.example.json-tools/1.0.0/org.example.json-tools/summary',
      categoryId: 'data',
      category: 'Data',
      path: '/extensions/org.example.json-tools/1.0.0/summary',
      platforms: ['electron'],
      extensionOwned: true,
    });
    expect(projection.registrations[0]?.workbench).toMatchObject({
      pluginId: 'org.example.json-tools',
      toolId: 'org.example.json-tools/summary',
      commandId: 'org.example.json-tools/summarize',
      fields: [{ type: 'textarea', id: 'input' }],
      resultKind: 'json',
    });
    expect(projection.commands).toEqual([expect.objectContaining({
      id: 'org.example.json-tools/summarize',
      targetPath: '/extensions/org.example.json-tools/1.0.0/summary',
    })]);
  });

  it('maps all declared input controls to host-owned fields', () => {
    const manifest = createManifest();
    const extended = {
      ...manifest,
      contributions: {
        ...manifest.contributions,
        tools: [{
          ...manifest.contributions.tools[0]!,
          inputs: [
            { kind: 'number', id: 'count', label: 'Count', integer: true, minimum: 1, step: 1 },
            { kind: 'boolean', id: 'pretty', label: 'Pretty', defaultValue: true },
            { kind: 'select', id: 'format', label: 'Format', options: [{ value: 'compact', label: 'Compact' }] },
          ],
        }],
      },
    } as unknown as ExternalPluginV2Manifest;

    const projection = projectExternalPluginV2Manifest(extended, {
      component: async () => ({} as Component),
      icon: {} as Component,
    });
    expect(projection.registrations[0]?.workbench.fields).toEqual([
      expect.objectContaining({ type: 'number', id: 'count', integer: true, minimum: 1, step: 1 }),
      expect.objectContaining({ type: 'boolean', id: 'pretty', defaultValue: true }),
      expect.objectContaining({ type: 'select', id: 'format', options: [{ value: 'compact', label: 'Compact' }] }),
    ]);
  });

  it('projects the host-owned table result type', () => {
    const baseManifest = createManifest();
    const manifest = {
      ...baseManifest,
      contributions: {
        ...baseManifest.contributions,
        tools: [{
          ...baseManifest.contributions.tools[0]!,
          output: { kind: 'table' as const },
        }],
      },
    } as unknown as ExternalPluginV2Manifest;

    const projection = projectExternalPluginV2Manifest(manifest, {
      component: async () => ({} as Component),
      icon: {} as Component,
    });

    expect(projection.registrations[0]?.workbench.resultKind).toBe('table');
  });

  it('rejects multiple commands bound to one tool', () => {
    const manifest = createManifest();
    const duplicateCommand = {
      ...manifest,
      contributions: {
        ...manifest.contributions,
        commands: [
          ...manifest.contributions.commands,
          {
            id: 'org.example.json-tools/other',
            title: 'Other',
            description: 'Other command.',
            keywords: [],
            toolId: 'org.example.json-tools/summary',
          },
        ],
      },
    } as unknown as ExternalPluginV2Manifest;

    expect(() => projectExternalPluginV2Manifest(duplicateCommand, {
      component: async () => ({} as Component),
      icon: {} as Component,
    })).toThrow(/exactly one command/);
  });
});
