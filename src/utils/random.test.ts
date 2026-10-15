import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateRandomIdWithSource,
  getRandomBytes,
  randFromArray,
  randIntFromInterval,
  random,
  shuffleArray,
  shuffleArrayMutate,
  shuffleString,
  type RandomSource,
} from './random';

const MAX_UINT32 = 0xffff_ffff;

function createUint32Source(values: number[], fallback = 0): RandomSource & ReturnType<typeof vi.fn> {
  let index = 0;

  return vi.fn((bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < bytes.byteLength; offset += 4) {
      view.setUint32(offset, values[index++] ?? fallback, true);
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('random helpers', () => {
  it('fills requested bytes with the default Web Crypto source', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xa5);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(getRandomBytes(4)).toEqual(new Uint8Array([0xa5, 0xa5, 0xa5, 0xa5]));
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('fails closed when Web Crypto is unavailable and does not call Math.random', () => {
    vi.stubGlobal('crypto', undefined);
    const mathRandom = vi.spyOn(Math, 'random');

    expect(() => random()).toThrow('Web Crypto getRandomValues is unavailable.');
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('propagates a random-source failure without retrying through another source', () => {
    const source = () => {
      throw new Error('test random source failed');
    };
    const mathRandom = vi.spyOn(Math, 'random');

    expect(() => random(source)).toThrow('test random source failed');
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('rejects invalid byte lengths before calling the source', () => {
    const source = createUint32Source([]);

    expect(() => getRandomBytes(-1, source)).toThrow(RangeError);
    expect(() => getRandomBytes(1.5, source)).toThrow(RangeError);
    expect(() => getRandomBytes(65_537, source)).toThrow(RangeError);
    expect(source).not.toHaveBeenCalled();
  });

  it('returns a 32-bit fraction inside [0, 1)', () => {
    expect(random(createUint32Source([0]))).toBe(0);
    expect(random(createUint32Source([MAX_UINT32]))).toBeLessThan(1);
  });

  it('maps integers to a half-open interval without modulo bias', () => {
    const source = createUint32Source([MAX_UINT32, 2]);

    expect(randIntFromInterval(10, 13, source)).toBe(12);
    expect(source).toHaveBeenCalledTimes(2);
    expect(randIntFromInterval(10, 13, createUint32Source([0]))).toBe(10);
  });

  it('keeps the single-point interval and rejects invalid or oversized bounds', () => {
    const source = createUint32Source([]);

    expect(randIntFromInterval(5, 5, source)).toBe(5);
    expect(source).not.toHaveBeenCalled();
    expect(() => randIntFromInterval(5, 4, source)).toThrow(RangeError);
    expect(() => randIntFromInterval(0, 1.5, source)).toThrow(RangeError);
    expect(() => randIntFromInterval(0, 0x1_0000_0001, source)).toThrow(RangeError);
  });

  it('stops after the configured rejection limit', () => {
    const source = createUint32Source([], MAX_UINT32);

    expect(() => randIntFromInterval(0, 3, source)).toThrow('Random source rejected 128 consecutive samples.');
    expect(source).toHaveBeenCalledTimes(128);
  });

  it('returns undefined for an empty array and samples populated arrays uniformly', () => {
    const source = createUint32Source([MAX_UINT32]);

    expect(randFromArray([], source)).toBeUndefined();
    expect(source).not.toHaveBeenCalled();
    expect(randFromArray(['first', 'last'], source)).toBe('last');
  });

  it('shuffles arrays and strings with a deterministic source', () => {
    const input = ['a', 'b', 'c'];
    const shuffled = shuffleArray(input, createUint32Source([0, 1]));
    const mutable = [...input];

    expect(shuffled).toEqual(['c', 'b', 'a']);
    expect(input).toEqual(['a', 'b', 'c']);
    expect(shuffleArrayMutate(mutable, createUint32Source([0, 1]))).toEqual(['c', 'b', 'a']);
    expect(shuffleString('abc', '', createUint32Source([0, 1]))).toBe('cba');
  });

  it('bounds shuffle inputs and creates a fixed-format id', () => {
    expect(() => shuffleArray(new Array(65_537), createUint32Source([]))).toThrow(RangeError);
    expect(() => shuffleString('a'.repeat(65_537), '', createUint32Source([]))).toThrow(RangeError);
    expect(generateRandomIdWithSource(createUint32Source([0]))).toBe('id-0000000000');
  });
});
