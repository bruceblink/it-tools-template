/** A source fills the supplied byte buffer with random bytes. */
export type RandomSource = (bytes: Uint8Array) => void

const MAX_RANDOM_BYTES = 65_536;
const MAX_RANDOM_ATTEMPTS = 128;
const UINT32_RANGE = 0x1_0000_0000;
const FLOAT_RANGE = 0x20_0000_0000_0000;
const MAX_SHUFFLE_LENGTH = 65_536;
const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Fills a buffer with Web Crypto bytes; unavailable crypto and requests above 65,536 bytes fail explicitly. */
export const webCryptoRandomSource: RandomSource = (bytes) => {
  if (bytes.byteLength > MAX_RANDOM_BYTES) {
    throw new RangeError(`Random byte requests must not exceed ${MAX_RANDOM_BYTES} bytes.`);
  }

  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Web Crypto getRandomValues is unavailable.');
  }

  cryptoApi.getRandomValues(bytes);
};

/** Allocates 0 to 65,536 bytes; source failures propagate and oversized requests fail before allocation. */
export function getRandomBytes(length: number, source: RandomSource = webCryptoRandomSource): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RANDOM_BYTES) {
    throw new RangeError(`Random byte length must be an integer from 0 to ${MAX_RANDOM_BYTES}.`);
  }

  const bytes = new Uint8Array(length);
  if (length > 0) {
    source(bytes);
  }

  return bytes;
}

/** Reads one unsigned 32-bit value from the source in little-endian byte order. */
function getRandomUint32(source: RandomSource): number {
  const bytes = getRandomBytes(4, source);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}

/** Selects in [min, maxExclusive) without modulo bias; the span is at most 2^32 and rejection stops after 128 samples. */
function randomIntFromRange(min: number, maxExclusive: number, source: RandomSource): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(maxExclusive) || maxExclusive <= min) {
    throw new RangeError('Random integer bounds must be safe integers with max greater than min.');
  }

  const range = maxExclusive - min;
  if (range > UINT32_RANGE) {
    throw new RangeError(`Random integer ranges must not exceed ${UINT32_RANGE}.`);
  }

  const acceptedSampleLimit = Math.floor(UINT32_RANGE / range) * range;
  for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt++) {
    const sample = getRandomUint32(source);
    if (sample < acceptedSampleLimit) {
      return min + (sample % range);
    }
  }

  throw new Error(`Random source rejected ${MAX_RANDOM_ATTEMPTS} consecutive samples.`);
}

/** Returns a 53-bit fraction in [0, 1) to preserve the previous helper's output resolution. */
export function random(source: RandomSource = webCryptoRandomSource): number {
  const highBits = getRandomUint32(source) >>> 5;
  const lowBits = getRandomUint32(source) >>> 6;
  return (highBits * 0x400_0000 + lowBits) / FLOAT_RANGE;
}

/** Picks an array entry uniformly; an empty array keeps its historical undefined result. */
export function randFromArray<T>(array: T[], source: RandomSource = webCryptoRandomSource): T | undefined {
  if (array.length === 0) {
    return undefined;
  }

  return array[randomIntFromRange(0, array.length, source)];
}

/** Uses a half-open interval and preserves the existing single-point behavior. */
export function randIntFromInterval(min: number, max: number, source: RandomSource = webCryptoRandomSource): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new RangeError('Random interval bounds must be safe integers with max greater than or equal to min.');
  }

  if (max === min) {
    return min;
  }

  return randomIntFromRange(min, max, source);
}

/** Applies the Durstenfeld shuffle in place, with each swap index sampled uniformly. */
export function shuffleArrayMutate<T>(array: T[], source: RandomSource = webCryptoRandomSource): T[] {
  if (array.length > MAX_SHUFFLE_LENGTH) {
    throw new RangeError(`Arrays longer than ${MAX_SHUFFLE_LENGTH} items cannot be shuffled.`);
  }

  for (let i = array.length - 1; i > 0; i--) {
    const j = randomIntFromRange(0, i + 1, source);
    // Both indexes are bounded by the current length, including arrays of optional values.
    [array[i], array[j]] = [array[j] as T, array[i] as T];
  }

  return array;
}

/** Returns a shuffled copy while keeping the caller's array unchanged. */
export function shuffleArray<T>(array: T[], source: RandomSource = webCryptoRandomSource): T[] {
  if (array.length > MAX_SHUFFLE_LENGTH) {
    throw new RangeError(`Arrays longer than ${MAX_SHUFFLE_LENGTH} items cannot be shuffled.`);
  }

  return shuffleArrayMutate([...array], source);
}

/** Shuffles UTF-16 code units or delimiter-separated parts, subject to a bounded input size. */
export function shuffleString(str: string, delimiter = '', source: RandomSource = webCryptoRandomSource): string {
  if (str.length > MAX_SHUFFLE_LENGTH) {
    throw new RangeError(`Strings longer than ${MAX_SHUFFLE_LENGTH} code units cannot be shuffled.`);
  }

  return shuffleArrayMutate(str.split(delimiter), source).join(delimiter);
}

/** Creates a stable-format DOM id with ten uniformly sampled lowercase base-36 digits. */
export function generateRandomId(): string {
  return generateRandomIdWithSource(webCryptoRandomSource);
}

/** Creates a deterministic testable DOM id from an explicitly supplied source. */
export function generateRandomIdWithSource(source: RandomSource): string {
  let suffix = '';
  for (let i = 0; i < 10; i++) {
    suffix += BASE36_ALPHABET[randomIntFromRange(0, BASE36_ALPHABET.length, source)];
  }

  return `id-${suffix}`;
}
