import { compareSync, hashSync } from 'bcryptjs';
import { maxBcryptSaltRounds, minBcryptSaltRounds } from './bcrypt.constants';

export { maxBcryptSaltRounds, minBcryptSaltRounds } from './bcrypt.constants';

export function generateBcryptHash(value: string, saltRounds: number): string {
  if (!Number.isInteger(saltRounds) || saltRounds < minBcryptSaltRounds || saltRounds > maxBcryptSaltRounds) {
    throw new RangeError(`Salt rounds must be between ${minBcryptSaltRounds} and ${maxBcryptSaltRounds}.`);
  }

  return hashSync(value, saltRounds);
}

export function compareBcryptHash(value: string, hash: string): boolean {
  if (hash.length !== 60) {
    return false;
  }

  return compareSync(value, hash);
}
