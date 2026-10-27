import { describe, expect, it } from 'vitest';
import {
  isToolDataProcessing,
  isToolOfflineSupport,
  toolDataProcessingValues,
  toolOfflineSupportValues,
} from './plugin-tool-metadata';

describe('plugin tool governance metadata', () => {
  it('exposes the complete stable value sets', () => {
    expect(toolDataProcessingValues).toEqual([
      'memory-only',
      'local-data',
      'user-selected-files',
      'network',
      'unspecified',
    ]);
    expect(toolOfflineSupportValues).toEqual([
      'available',
      'requires-network',
      'conditional',
      'unknown',
    ]);
  });

  it('rejects values outside the shared contract', () => {
    expect(isToolDataProcessing('remote-execution')).toBe(false);
    expect(isToolDataProcessing(undefined)).toBe(false);
    expect(isToolOfflineSupport('always-online')).toBe(false);
    expect(isToolOfflineSupport(null)).toBe(false);
  });
});
