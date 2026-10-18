import { describe, expect, it } from 'vitest';
import { compareBcryptHash, generateBcryptHash, maxBcryptSaltRounds, minBcryptSaltRounds } from './bcrypt.service';

describe('bcrypt service', () => {
  it('generates hashes and compares matching or non-matching values', () => {
    const hash = generateBcryptHash('synthetic password', minBcryptSaltRounds);

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(compareBcryptHash('synthetic password', hash)).toBe(true);
    expect(compareBcryptHash('different password', hash)).toBe(false);
    expect(compareBcryptHash('synthetic password', 'invalid')).toBe(false);
  });

  it('rejects salt rounds outside the bounded range', () => {
    expect(() => generateBcryptHash('password', minBcryptSaltRounds - 1)).toThrow(RangeError);
    expect(() => generateBcryptHash('password', maxBcryptSaltRounds + 1)).toThrow(RangeError);
  });
});
