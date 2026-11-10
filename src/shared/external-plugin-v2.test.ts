import { describe, expect, it } from 'vitest';
import {
  validateExternalPluginV2Manifest,
  type ExternalPluginV2Manifest,
} from './external-plugin-v2';

const pluginId = 'org.example.json-tools';

function createManifest(): ExternalPluginV2Manifest {
  return {
    formatVersion: 2,
    id: pluginId,
    name: 'JSON Tools',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: [],
    activationEvents: [
      `onTool:${pluginId}/summary`,
      `onCommand:${pluginId}/summarize`,
    ],
    contributions: {
      tools: [{
        id: `${pluginId}/summary`,
        title: 'JSON summary',
        description: 'Summarize a JSON document.',
        keywords: ['json', 'summary'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
        inputs: [{ id: 'input', kind: 'text', label: 'JSON input', required: true, maxLength: 1024 }],
        output: { kind: 'json' },
      }],
      commands: [{
        id: `${pluginId}/summarize`,
        title: 'Summarize JSON',
        description: 'Summarize a JSON document.',
        keywords: ['json'],
        toolId: `${pluginId}/summary`,
      }],
    },
  };
}

describe('external plugin v2 manifest', () => {
  it('accepts a namespaced declarative tool and command', () => {
    const manifest = validateExternalPluginV2Manifest(createManifest());
    expect(manifest.contributions.tools[0]?.inputs[0]).toMatchObject({ kind: 'text', id: 'input' });
    expect(manifest.contributions.commands[0]?.toolId).toBe(`${pluginId}/summary`);
  });

  it('rejects undeclared activation targets and capabilities', () => {
    const missingActivation = {
      ...createManifest(),
      activationEvents: [`onTool:${pluginId}/summary`] as const,
    };
    expect(() => validateExternalPluginV2Manifest(missingActivation)).toThrow(/Activation event/);

    const base = createManifest();
    const undeclaredCapability = {
      ...base,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, capabilities: ['clipboard.write' as const] }],
      },
    };
    expect(() => validateExternalPluginV2Manifest(undeclaredCapability)).toThrow(/not declared/);
  });

  it('rejects unsafe fields and host API ranges', () => {
    const base = createManifest();
    const invalidCategory = {
      ...base,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, categoryId: 'Development' }],
      },
    };
    expect(() => validateExternalPluginV2Manifest(invalidCategory)).toThrow(/category/);

    expect(() => validateExternalPluginV2Manifest(createManifest(), '3.0.0')).toThrow(/does not support/);
  });
});
