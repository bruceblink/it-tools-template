import type { lib } from 'crypto-js';
import {
  HmacMD5,
  HmacRIPEMD160,
  HmacSHA1,
  HmacSHA224,
  HmacSHA256,
  HmacSHA3,
  HmacSHA384,
  HmacSHA512,
  enc,
} from 'crypto-js';
import { convertHexToBin } from '../hash-text/hash-text.service';

export const hmacAlgorithms = {
  MD5: HmacMD5,
  RIPEMD160: HmacRIPEMD160,
  SHA1: HmacSHA1,
  SHA3: HmacSHA3,
  SHA224: HmacSHA224,
  SHA256: HmacSHA256,
  SHA384: HmacSHA384,
  SHA512: HmacSHA512,
} as const;

export type HmacAlgorithm = keyof typeof hmacAlgorithms;
export type HmacEncoding = keyof typeof enc | 'Bin';

export interface HmacGenerationResult {
  value: string
  warnings: string[]
}

export function formatHmacWords(words: lib.WordArray, encoding: HmacEncoding): string {
  if (encoding === 'Bin') {
    return convertHexToBin(words.toString(enc.Hex));
  }

  return words.toString(enc[encoding]);
}

export function generateHmac({
  algorithm,
  encoding,
  plainText,
  secret,
}: {
  algorithm: HmacAlgorithm
  encoding: HmacEncoding
  plainText: string
  secret: string
}): HmacGenerationResult {
  const warnings: string[] = [];

  if (!secret) {
    warnings.push('Secret key is empty.');
  }

  return {
    value: formatHmacWords(hmacAlgorithms[algorithm](plainText, secret), encoding),
    warnings,
  };
}
