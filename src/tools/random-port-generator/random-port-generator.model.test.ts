import { describe, expect, it } from 'vitest';
import { generatePort, getPortRangeSummary, PORT_RANGE_PRESETS } from './random-port-generator.model';

describe('random-port-generator model', () => {
  it('generates ports in the default unprivileged range', () => {
    const port = generatePort();

    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('generates ports inside a custom range', () => {
    const port = generatePort({ min: 3000, max: 3000 });

    expect(port).toBe(3000);
  });

  it('summarizes built-in ranges', () => {
    expect(getPortRangeSummary(PORT_RANGE_PRESETS.dynamic)).toEqual({
      min: 49152,
      max: 65535,
      size: 16384,
      valid: true,
      warning: undefined,
    });
  });

  it('rejects invalid ranges', () => {
    expect(getPortRangeSummary({ min: 9000, max: 8000 })).toMatchObject({
      size: 0,
      valid: false,
      warning: 'Port range must use integers from 0 to 65535 and min must be less than or equal to max.',
    });
    expect(() => generatePort({ min: -1, max: 10 })).toThrow('Port range must use integers');
  });
});
