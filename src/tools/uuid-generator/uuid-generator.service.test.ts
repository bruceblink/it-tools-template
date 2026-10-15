import { describe, expect, it } from 'vitest';
import type { RandomSource } from '@/utils/random';
import { generateUuidV1, generateUuidV4 } from './uuid-generator.service';

function createConstantSource(byte: number): RandomSource {
  return bytes => bytes.fill(byte);
}

describe('UUID generator service', () => {
  it('generates deterministic UUID v1 output with an injected source and time', () => {
    const options = { sequence: 12, now: 1_700_000_000_000 };
    const first = generateUuidV1(options, createConstantSource(0));
    const second = generateUuidV1(options, createConstantSource(0));
    const nextSequence = generateUuidV1({ ...options, sequence: 13 }, createConstantSource(0));

    expect(first).toBe(second);
    expect(first).not.toBe(nextSequence);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.endsWith('010000000000')).toBe(true);
  });

  it('rejects invalid UUID v1 sequence and time inputs', () => {
    const source = createConstantSource(0);

    expect(() => generateUuidV1({ sequence: -1 }, source)).toThrow(RangeError);
    expect(() => generateUuidV1({ sequence: 0x4000 }, source)).toThrow(RangeError);
    expect(() => generateUuidV1({ sequence: 0, now: Number.NaN }, source)).toThrow(RangeError);
  });

  it('generates UUID v4 from exactly 16 injected bytes', () => {
    let requestedBytes = 0;
    const source: RandomSource = (bytes) => {
      requestedBytes += bytes.byteLength;
      bytes.fill(0);
    };

    expect(generateUuidV4(source)).toBe('00000000-0000-4000-8000-000000000000');
    expect(requestedBytes).toBe(16);
  });

  it('propagates UUID random-source failures', () => {
    const source = () => {
      throw new Error('test UUID source failed');
    };

    expect(() => generateUuidV4(source)).toThrow('test UUID source failed');
  });
});
