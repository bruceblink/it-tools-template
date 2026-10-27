import { describe, expect, it } from 'vitest';
import {
  isPluginCapabilityId,
  firstPartyExtensionCapabilityIds,
  pluginCapabilityIds,
  pluginHostCapabilityIds,
} from './plugin-capabilities';

describe('shared plugin capability catalog', () => {
  it('keeps the declared IDs unique and validates known values', () => {
    expect(new Set(pluginCapabilityIds).size).toBe(pluginCapabilityIds.length);
    expect(pluginCapabilityIds).toEqual([
      'clipboard.write',
      'data.oui',
      'device.camera',
      'file.read',
      'file.save',
      'runtime.info',
      'settings.read',
      'settings.write',
    ]);
    expect(isPluginCapabilityId('file.read')).toBe(true);
    expect(isPluginCapabilityId('system.shell')).toBe(false);
  });

  it('keeps the host execution set as a subset of declared IDs', () => {
    expect(pluginHostCapabilityIds.every(capability => pluginCapabilityIds.includes(capability))).toBe(true);
    expect(pluginHostCapabilityIds).toEqual([
      'runtime.info',
      'clipboard.write',
      'settings.read',
      'settings.write',
    ]);
  });

  it('keeps first-party extension capabilities on the declared ID list', () => {
    expect(firstPartyExtensionCapabilityIds.every(capability => pluginCapabilityIds.includes(capability))).toBe(true);
    expect(firstPartyExtensionCapabilityIds).toEqual([
      'clipboard.write',
      'file.read',
      'file.save',
      'device.camera',
      'runtime.info',
      'data.oui',
    ]);
  });
});
