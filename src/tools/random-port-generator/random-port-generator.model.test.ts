import { describe, expect, it, vi } from 'vitest';
import type { RandomSource } from '@/utils/random';
import { generatePort, getPortRangeSummary, PORT_RANGE_PRESETS } from './random-port-generator.model';

function sourceForUint32(value: number): RandomSource {
  return (bytes) => {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, value, true);
  };
}

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

  it('can generate both inclusive endpoints of the default range', () => {
    const range = PORT_RANGE_PRESETS.allUnprivileged;
    const rangeSize = range.max + 1 - range.min;
    const largestAcceptedSample = Math.floor(0x1_0000_0000 / rangeSize) * rangeSize - 1;

    expect(generatePort(range, sourceForUint32(0))).toBe(range.min);
    expect(generatePort(range, sourceForUint32(largestAcceptedSample))).toBe(range.max);
  });

  it('keeps an inclusive single-point range without requesting random bytes', () => {
    const source = vi.fn(() => {
      throw new Error('single-point ranges need no random sample');
    });

    expect(generatePort({ min: 65535, max: 65535 }, source)).toBe(65535);
    expect(source).not.toHaveBeenCalled();
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
    expect(() => generatePort({ min: 10.5, max: 12 })).toThrow('Port range must use integers');
  });
});
