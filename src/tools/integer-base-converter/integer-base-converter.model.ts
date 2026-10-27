const digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';
const minBase = 2;
const maxBase = digits.length;

export interface IntegerBaseConversionOutputs {
  base2: string
  base8: string
  base10: string
  base16: string
  base64: string
  custom: string
}

function assertBase(base: number): void {
  if (!Number.isInteger(base) || base < minBase || base > maxBase) {
    throw new Error(`Base must be an integer between ${minBase} and ${maxBase}.`);
  }
}

/** Parse an input once using multiplication and addition instead of per-digit exponentiation. */
export function parseBaseValue(value: string, fromBase: number): bigint {
  assertBase(fromBase);
  const fromDigits = digits.slice(0, fromBase);
  let decimal = 0n;
  const base = BigInt(fromBase);
  for (const digit of value) {
    const digitValue = fromDigits.indexOf(digit);
    if (digitValue < 0) {
      throw new Error(`Invalid digit "${digit}" for base ${fromBase}.`);
    }
    decimal = decimal * base + BigInt(digitValue);
  }
  return decimal;
}

/** Format a parsed value in one target base. The input value is never mutated. */
export function formatBaseValue(decimal: bigint, toBase: number): string {
  assertBase(toBase);
  const targetDigits = digits.slice(0, toBase);
  const base = BigInt(toBase);
  if (decimal === 0n) {
    return '0';
  }

  let remaining = decimal;
  const output: string[] = [];
  while (remaining > 0n) {
    output.push(targetDigits[Number(remaining % base)]!);
    remaining /= base;
  }
  return output.reverse().join('');
}

export function convertBase({ value, fromBase, toBase }: { value: string; fromBase: number; toBase: number }): string {
  return formatBaseValue(parseBaseValue(value, fromBase), toBase);
}

/** Convert all fixed outputs from one parsed value to avoid repeating the expensive BigInt parse. */
export function convertBaseOutputs({ value, fromBase, customBase }: { value: string; fromBase: number; customBase: number }): IntegerBaseConversionOutputs {
  const decimal = parseBaseValue(value, fromBase);
  return {
    base2: formatBaseValue(decimal, 2),
    base8: formatBaseValue(decimal, 8),
    base10: formatBaseValue(decimal, 10),
    base16: formatBaseValue(decimal, 16),
    base64: formatBaseValue(decimal, 64),
    custom: formatBaseValue(decimal, customBase),
  };
}
