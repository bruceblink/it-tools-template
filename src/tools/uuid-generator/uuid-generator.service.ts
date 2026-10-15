import { v1 as uuidV1, v4 as uuidV4 } from 'uuid';
import { getRandomBytes, randIntFromInterval, webCryptoRandomSource, type RandomSource } from '@/utils/random';

const MAX_CLOCK_SEQUENCE = 0x3fff;
const UUID_V1_NANOSECOND_RANGE = 10_000;

/** Builds UUID v1 from a safe millisecond timestamp and a 14-bit batch sequence; source failures propagate. */
export function generateUuidV1({ sequence, now = Date.now() }: { sequence: number; now?: number }, source: RandomSource = webCryptoRandomSource): string {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > MAX_CLOCK_SEQUENCE) {
    throw new RangeError(`UUID v1 sequence must be an integer from 0 to ${MAX_CLOCK_SEQUENCE}.`);
  }
  if (!Number.isSafeInteger(now)) {
    throw new RangeError('UUID v1 time must be a safe integer number of milliseconds.');
  }

  // uuid v13 requires a 16-byte random array even when clock sequence and node bytes are supplied.
  const random = getRandomBytes(16, source);
  const node = random.slice(10, 16);
  // RFC 9562 section 6.10 marks a random node identifier by setting the first octet's least significant bit.
  node[0] = node[0]! | 0x01;
  const nsecs = randIntFromInterval(0, UUID_V1_NANOSECOND_RANGE, source);

  return uuidV1({ clockseq: sequence, msecs: now, nsecs, node, random });
}

/** Builds a UUID v4 from the same injectable 16-byte source used by the other random helpers. */
export function generateUuidV4(source: RandomSource = webCryptoRandomSource): string {
  return uuidV4({ random: getRandomBytes(16, source) });
}
