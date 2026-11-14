import { describe, expect, it } from 'vitest';
import {
  desktopPluginErrorCodes,
  desktopPluginMarketplaceInstallPhases,
  desktopPluginV2RuntimeFailureCodes,
  desktopPluginStateChangeReasons,
  isDesktopPluginMarketplaceInstallProgress,
  isDesktopPluginStateChangeEvent,
} from './plugins';

describe('desktop plugin bridge error catalog', () => {
  it('keeps management error codes unique and covers each boundary', () => {
    expect(new Set(desktopPluginErrorCodes).size).toBe(desktopPluginErrorCodes.length);
    expect(desktopPluginErrorCodes).toEqual(expect.arrayContaining([
      'invalid-package',
      'unsupported-capability',
      'trust-confirmation-required',
      'invalid-request',
      'operation-failed',
    ]));
  });

  it('keeps v2 retry diagnostics stable and separate from user decisions', () => {
    expect(desktopPluginV2RuntimeFailureCodes).toEqual([
      'transport-error',
      'extension-failed',
      'timeout',
      'protocol-error',
    ]);
    expect(new Set(desktopPluginV2RuntimeFailureCodes).size).toBe(desktopPluginV2RuntimeFailureCodes.length);
  });

  it('accepts bounded state change events and rejects malformed IPC payloads', () => {
    expect(desktopPluginStateChangeReasons).toEqual([
      'installed',
      'uninstalled',
      'activated',
      'deactivated',
      'enabled',
      'disabled',
      'runtime-failure',
      'runtime-recovered',
    ]);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'org.example.plugin',
      version: '1.2.3',
      reason: 'runtime-failure',
      runtimeFailureCode: 'extension-failed',
    })).toBe(true);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'C:\\secret',
      version: '1.2.3',
      reason: 'installed',
      contributionId: 'org.example.plugin/example-tool',
    })).toBe(false);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'org.example.plugin',
      version: '1.2.3',
      reason: 'unknown',
      extra: 'ignored',
    })).toBe(false);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'org.example.plugin',
      version: '1.2.3',
      reason: 'runtime-failure',
      runtimeFailureCode: 'permission-denied',
    })).toBe(false);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'org.example.plugin',
      version: '1.2.3',
      reason: 'runtime-recovered',
      runtimeFailureCode: 'timeout',
    })).toBe(false);
  });

  it('validates marketplace progress events and bounds transfer metadata', () => {
    expect(desktopPluginMarketplaceInstallPhases).toEqual([
      'discovering',
      'pinned',
      'downloading',
      'verifying',
      'installing',
      'completed',
      'cancelled',
    ]);
    expect(isDesktopPluginMarketplaceInstallProgress({
      requestId: 'marketplace-1',
      phase: 'downloading',
      repository: 'example/demo-plugin',
      tagName: 'v1.0.0',
      commitSha: 'a'.repeat(40),
      assetName: 'demo.itxs',
      transferredBytes: 12,
      totalBytes: 24,
    })).toBe(true);
    expect(isDesktopPluginMarketplaceInstallProgress({
      requestId: 'bad request',
      phase: 'downloading',
      transferredBytes: -1,
    })).toBe(false);
    expect(isDesktopPluginMarketplaceInstallProgress({
      requestId: 'marketplace-1',
      phase: 'unknown',
      totalBytes: Number.MAX_SAFE_INTEGER + 1,
    })).toBe(false);
    expect(isDesktopPluginMarketplaceInstallProgress({
      requestId: 'marketplace-1',
      phase: 'discovering',
      transferredBytes: null,
    })).toBe(false);
    expect(isDesktopPluginMarketplaceInstallProgress({
      requestId: 'marketplace-1',
      phase: 'discovering',
      totalBytes: null,
    })).toBe(true);
  });

});
