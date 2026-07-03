export const HASH_DIGEST_BITS = {
  MD5: 128,
  SHA1: 160,
  SHA224: 224,
  SHA256: 256,
  SHA384: 384,
  SHA512: 512,
  SHA3: 512,
  RIPEMD160: 160,
} as const;

export type HashAlgorithmName = keyof typeof HASH_DIGEST_BITS;

export function convertHexToBin(hex: string) {
  return hex
    .trim()
    .split('')
    .map(byte => Number.parseInt(byte, 16).toString(2).padStart(4, '0'))
    .join('');
}

export function getHashDigestSize(algorithm: HashAlgorithmName) {
  const bits = HASH_DIGEST_BITS[algorithm];

  return {
    bits,
    bytes: bits / 8,
  };
}
