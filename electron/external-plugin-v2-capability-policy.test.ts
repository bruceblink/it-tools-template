// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createExternalPluginV2CapabilityPolicy,
  ExternalPluginV2CapabilityPolicyError,
} from './external-plugin-v2-capability-policy';
import type { ExternalPluginV2Manifest } from '../src/shared/external-plugin-v2';

const manifest: ExternalPluginV2Manifest = {
  formatVersion: 2,
  id: 'org.it-tools.capability-demo',
  name: 'Capability demo',
  version: '1.0.0',
  apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
  requestedCapabilities: ['runtime.info', 'clipboard.write'],
  activationEvents: ['onTool:org.it-tools.capability-demo/copy'],
  contributions: {
    tools: [{
      id: 'org.it-tools.capability-demo/copy',
      title: 'Copy',
      description: 'Copy text.',
      keywords: ['copy'],
      categoryId: 'development',
      dataProcessing: 'memory-only',
      offline: 'available',
      capabilities: ['clipboard.write'],
      inputs: [],
      output: { kind: 'text' },
    }],
    commands: [{
      id: 'org.it-tools.capability-demo/copy',
      title: 'Copy',
      description: 'Copy text.',
      keywords: ['copy'],
      toolId: 'org.it-tools.capability-demo/copy',
    }],
  },
};

describe('v2 capability policy', () => {
  it('keeps requested, supported, and granted sets separate', () => {
    const policy = createExternalPluginV2CapabilityPolicy(manifest, ['clipboard.write']);

    expect(policy.requestedCapabilities).toEqual(['runtime.info', 'clipboard.write']);
    expect(policy.supportedCapabilities).toEqual(['runtime.info', 'clipboard.write']);
    expect(policy.grantedCapabilities).toEqual(['clipboard.write']);
    expect(policy.authorizeTool('org.it-tools.capability-demo/copy')).toEqual(['clipboard.write']);
  });

  it('rejects a grant that was not declared by the package', () => {
    expect(() => createExternalPluginV2CapabilityPolicy(manifest, ['settings.read'])).toThrowError(
      expect.objectContaining<Partial<ExternalPluginV2CapabilityPolicyError>>({ code: 'capability-not-requested' }),
    );
  });

  it('rejects an unsupported host capability before activation', () => {
    const manifestWithFileRead = {
      ...manifest,
      requestedCapabilities: ['file.read'] as const,
      contributions: {
        ...manifest.contributions,
        tools: [{ ...manifest.contributions.tools[0]!, capabilities: [] as const }],
      },
    };
    expect(() => createExternalPluginV2CapabilityPolicy(manifestWithFileRead, ['file.read'])).toThrowError(
      expect.objectContaining<Partial<ExternalPluginV2CapabilityPolicyError>>({ code: 'unsupported-capability' }),
    );
  });

  it('rejects a tool when the user has not approved its declared capability', () => {
    const policy = createExternalPluginV2CapabilityPolicy(manifest, []);

    expect(() => policy.authorizeTool('org.it-tools.capability-demo/copy')).toThrowError(
      expect.objectContaining<Partial<ExternalPluginV2CapabilityPolicyError>>({ code: 'permission-denied' }),
    );
  });

  it('rejects a tool capability that is outside the package request set', () => {
    const undeclaredToolManifest = {
      ...manifest,
      contributions: {
        ...manifest.contributions,
        tools: [{ ...manifest.contributions.tools[0]!, capabilities: ['settings.read'] as const }],
      },
    };
    const policy = createExternalPluginV2CapabilityPolicy(undeclaredToolManifest, ['clipboard.write']);

    expect(() => policy.authorizeTool('org.it-tools.capability-demo/copy')).toThrowError(
      expect.objectContaining<Partial<ExternalPluginV2CapabilityPolicyError>>({ code: 'capability-not-requested' }),
    );
  });

  it('rejects a declared tool capability that this host cannot execute', () => {
    const unsupportedToolManifest = {
      ...manifest,
      requestedCapabilities: ['file.read'] as const,
      contributions: {
        ...manifest.contributions,
        tools: [{ ...manifest.contributions.tools[0]!, capabilities: ['file.read'] as const }],
      },
    };
    const policy = createExternalPluginV2CapabilityPolicy(unsupportedToolManifest, []);

    expect(() => policy.authorizeTool('org.it-tools.capability-demo/copy')).toThrowError(
      expect.objectContaining<Partial<ExternalPluginV2CapabilityPolicyError>>({ code: 'unsupported-capability' }),
    );
  });

  it('rejects duplicate grants and unknown tools', () => {
    expect(() => createExternalPluginV2CapabilityPolicy(manifest, ['clipboard.write', 'clipboard.write'])).toThrowError(
      expect.objectContaining<Partial<ExternalPluginV2CapabilityPolicyError>>({ code: 'invalid-policy' }),
    );
    const policy = createExternalPluginV2CapabilityPolicy(manifest, ['clipboard.write']);
    expect(() => policy.authorizeTool('org.it-tools.capability-demo/missing')).toThrowError(
      expect.objectContaining<Partial<ExternalPluginV2CapabilityPolicyError>>({ code: 'invalid-policy' }),
    );
  });
});
