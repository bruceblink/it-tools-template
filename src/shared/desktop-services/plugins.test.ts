import { describe, expect, it } from 'vitest';
import {
  desktopPluginErrorCodes,
  desktopPluginRuntimeFailureCodes,
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
});
