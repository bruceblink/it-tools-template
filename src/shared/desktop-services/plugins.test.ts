import { describe, expect, it } from 'vitest';
import {
  desktopPluginErrorCodes,
  desktopPluginMarketplaceInstallPhases,
  desktopPluginSourceBuildPhases,
  desktopPluginRuntimeFailureCodes,
  desktopPluginStateChangeReasons,
  isDesktopPluginMarketplaceInstallProgress,
  isDesktopPluginSourceBuildProgress,
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

  it('keeps runtime failure codes separate from operation errors', () => {
    expect(new Set(desktopPluginRuntimeFailureCodes).size).toBe(desktopPluginRuntimeFailureCodes.length);
    expect(desktopPluginRuntimeFailureCodes).toEqual([
      'renderer-crashed',
      'renderer-unresponsive',
      'window-closed',
    ]);
    expect(desktopPluginRuntimeFailureCodes.some(code => (
      desktopPluginErrorCodes.includes(code as typeof desktopPluginErrorCodes[number])
    ))).toBe(false);
  });

  it('accepts bounded state change events and rejects malformed IPC payloads', () => {
    expect(desktopPluginStateChangeReasons).toEqual([
      'installed',
      'activated',
      'disabled',
      'uninstalled',
      'runtime-failure',
      'rollback',
    ]);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'org.example.plugin',
      version: '1.2.3',
      reason: 'runtime-failure',
      contributionId: 'org.example.plugin/example-tool',
    })).toBe(true);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'C:\\secret',
      version: '1.2.3',
      reason: 'activated',
    })).toBe(false);
    expect(isDesktopPluginStateChangeEvent({
      schemaVersion: 1,
      pluginId: 'org.example.plugin',
      version: '1.2.3',
      reason: 'unknown',
      extra: 'ignored',
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
      assetName: 'demo.itplugin',
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

  it('validates fixed source-build progress events', () => {
    expect(desktopPluginSourceBuildPhases).toEqual([
      'selecting-key',
      'building',
      'installing',
      'completed',
      'cancelled',
    ]);
    expect(isDesktopPluginSourceBuildProgress({
      requestId: 'source-1',
      phase: 'building',
      repository: 'example/demo-plugin',
      commitSha: 'a'.repeat(40),
    })).toBe(true);
    expect(isDesktopPluginSourceBuildProgress({
      requestId: 'source-1',
      phase: 'building',
      commitSha: 'not-a-commit',
    })).toBe(false);
    expect(isDesktopPluginSourceBuildProgress({
      requestId: 'source-1',
      phase: 'unknown',
    })).toBe(false);
  });
});
