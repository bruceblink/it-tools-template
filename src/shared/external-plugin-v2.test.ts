import { describe, expect, it } from 'vitest';
import {
  externalPluginV2SupportedCapabilities,
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
  it('keeps the supported capability list aligned with the v2 execution policy', () => {
    expect(externalPluginV2SupportedCapabilities).toEqual(['runtime.info', 'settings.read', 'data.oui']);
  });

  it('accepts a namespaced declarative tool and command', () => {
    const manifest = validateExternalPluginV2Manifest(createManifest());
    expect(manifest.contributions.tools[0]?.inputs[0]).toMatchObject({ kind: 'text', id: 'input' });
    expect(manifest.contributions.commands[0]?.toolId).toBe(`${pluginId}/summary`);
    expect(manifest.contributions.settings).toBeUndefined();
    expect(manifest.contributions.tools[0]?.settings).toBeUndefined();
  });

  it('accepts namespaced settings and tool references with settings.read', () => {
    const settingId = `${pluginId}/endpoint`;
    const manifest = validateExternalPluginV2Manifest({
      ...createManifest(),
      requestedCapabilities: ['settings.read'],
      contributions: {
        ...createManifest().contributions,
        tools: [{
          ...createManifest().contributions.tools[0]!,
          capabilities: ['settings.read'],
          settings: [settingId],
        }],
        settings: [{
          id: settingId,
          label: 'Endpoint',
          description: 'The service endpoint used by this tool.',
          type: 'string',
          defaultValue: 'https://example.test',
          maxLength: 256,
        }],
      },
    });

    expect(manifest.contributions.settings).toEqual([{
      id: settingId,
      label: 'Endpoint',
      description: 'The service endpoint used by this tool.',
      type: 'string',
      defaultValue: 'https://example.test',
      maxLength: 256,
    }]);
    expect(manifest.contributions.tools[0]?.settings).toEqual([settingId]);
  });

  it('rejects unknown setting references and references without settings.read', () => {
    const settingId = `${pluginId}/endpoint`;
    const base = createManifest();
    const unknownSetting = {
      ...base,
      requestedCapabilities: ['settings.read'] as const,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, capabilities: ['settings.read'] as const, settings: [settingId] }],
        settings: [],
      },
    };
    expect(() => validateExternalPluginV2Manifest(unknownSetting)).toThrow(/unknown setting/);

    const missingCapability = {
      ...base,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, settings: [settingId] }],
        settings: [{
          id: settingId,
          label: 'Endpoint',
          description: 'The service endpoint used by this tool.',
          type: 'string',
          defaultValue: 'https://example.test',
        }],
      },
    };
    expect(() => validateExternalPluginV2Manifest(missingCapability)).toThrow(/settings\.read/);
  });

  it('rejects invalid setting declarations and duplicate references', () => {
    const base = createManifest();
    const settingId = `${pluginId}/endpoint`;
    const invalidDefault = {
      ...base,
      requestedCapabilities: ['settings.read'] as const,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, capabilities: ['settings.read'] as const, settings: [settingId, settingId] }],
        settings: [{
          id: settingId,
          label: 'Endpoint',
          description: 'The service endpoint used by this tool.',
          type: 'string',
          defaultValue: 'https://example.test',
        }],
      },
    };
    expect(() => validateExternalPluginV2Manifest(invalidDefault)).toThrow(/unique list/);

    const wrongDefault = {
      ...base,
      contributions: {
        ...base.contributions,
        settings: [{
          id: settingId,
          label: 'Endpoint',
          description: 'The service endpoint used by this tool.',
          type: 'number',
          defaultValue: 'https://example.test',
        }],
      },
    };
    expect(() => validateExternalPluginV2Manifest(wrongDefault)).toThrow(/defaultValue/);

    const invalidSecret = {
      ...base,
      contributions: {
        ...base.contributions,
        settings: [{
          id: settingId,
          label: 'Endpoint',
          description: 'The service endpoint used by this tool.',
          type: 'string',
          defaultValue: 'value',
          secret: false,
        }],
      },
    };
    expect(() => validateExternalPluginV2Manifest(invalidSecret)).toThrow(/unsupported or missing fields/);
  });

  it('accepts a host-owned OUI provider reference with a text query input', () => {
    const providerId = `${pluginId}/oui-vendor`;
    const manifest = validateExternalPluginV2Manifest({
      ...createManifest(),
      requestedCapabilities: ['data.oui'],
      contributions: {
        ...createManifest().contributions,
        tools: [{
          ...createManifest().contributions.tools[0]!,
          capabilities: ['data.oui'],
          dataProviders: [{ id: providerId, queryInputId: 'input' }],
        }],
        dataProviders: [{
          id: providerId,
          label: 'OUI vendor data',
          description: 'Host-owned OUI vendor records.',
          kind: 'oui.vendor',
          version: '1.0.0',
          schemaVersion: 1,
          maxBytes: 512,
        }],
      },
    });

    expect(manifest.contributions.dataProviders).toEqual([{
      id: providerId,
      label: 'OUI vendor data',
      description: 'Host-owned OUI vendor records.',
      kind: 'oui.vendor',
      version: '1.0.0',
      schemaVersion: 1,
      maxBytes: 512,
    }]);
    expect(manifest.contributions.tools[0]?.dataProviders).toEqual([{ id: providerId, queryInputId: 'input' }]);
  });

  it('rejects invalid or unauthorized data provider references', () => {
    const providerId = `${pluginId}/oui-vendor`;
    const base = createManifest();
    const provider = {
      id: providerId,
      label: 'OUI vendor data',
      description: 'Host-owned OUI vendor records.',
      kind: 'oui.vendor' as const,
      version: '1.0.0',
      schemaVersion: 1,
      maxBytes: 512,
    };
    const missingCapability = {
      ...base,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, dataProviders: [{ id: providerId, queryInputId: 'input' }] }],
        dataProviders: [provider],
      },
    };
    expect(() => validateExternalPluginV2Manifest(missingCapability)).toThrow(/data\.oui/);

    const unknownProvider = {
      ...base,
      requestedCapabilities: ['data.oui'] as const,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, capabilities: ['data.oui'] as const, dataProviders: [{ id: providerId }] }],
        dataProviders: [],
      },
    };
    expect(() => validateExternalPluginV2Manifest(unknownProvider)).toThrow(/unknown data provider/);

    const invalidQueryInput = {
      ...base,
      requestedCapabilities: ['data.oui'] as const,
      contributions: {
        ...base.contributions,
        tools: [{
          ...base.contributions.tools[0]!,
          capabilities: ['data.oui'] as const,
          inputs: [{ id: 'count', kind: 'number' as const, label: 'Count' }],
          dataProviders: [{ id: providerId, queryInputId: 'count' }],
        }],
        dataProviders: [provider],
      },
    };
    expect(() => validateExternalPluginV2Manifest(invalidQueryInput)).toThrow(/must reference a text input/);

    expect(() => validateExternalPluginV2Manifest({
      ...base,
      contributions: {
        ...base.contributions,
        dataProviders: [{ ...provider, kind: 'arbitrary' }],
      },
    })).toThrow(/kind is not supported/);
  });

  it('accepts the optional integer constraint and keeps older number fields valid', () => {
    const base = createManifest();
    const numberField = { kind: 'number' as const, id: 'count', label: 'Count', minimum: 0, maximum: 100, step: 1 };
    const legacyManifest = {
      ...base,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, inputs: [numberField] }],
      },
    };
    const integerManifest = {
      ...base,
      contributions: {
        ...base.contributions,
        tools: [{ ...base.contributions.tools[0]!, inputs: [{ ...numberField, integer: true }] }],
      },
    };

    expect(validateExternalPluginV2Manifest(legacyManifest).contributions.tools[0]?.inputs[0]).toEqual(numberField);
    expect(validateExternalPluginV2Manifest(integerManifest).contributions.tools[0]?.inputs[0]).toEqual({
      ...numberField,
      integer: true,
    });
  });

  it('rejects a non-boolean integer declaration', () => {
    const base = createManifest();
    const invalidManifest = {
      ...base,
      contributions: {
        ...base.contributions,
        tools: [{
          ...base.contributions.tools[0]!,
          inputs: [{ kind: 'number', id: 'count', label: 'Count', integer: 'true' }],
        }],
      },
    };

    expect(() => validateExternalPluginV2Manifest(invalidManifest)).toThrow(/integer must be a boolean/);
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
