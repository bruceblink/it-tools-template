import _ from 'lodash';

export { splitPrefix, generateRandomMacAddress, summarizeMacAddressOptions };

interface MacAddressOptions {
  prefix?: string
  amount?: number
}

interface MacAddressSummary {
  amount: number
  prefixBytes: number
  randomBytes: number
  totalBytes: number
  warnings: string[]
}

function splitPrefix(prefix: string): string[] {
  const base = prefix.match(/[^0-9a-f]/i) === null ? prefix.match(/.{1,2}/g) ?? [] : prefix.split(/[^0-9a-f]/i);

  return base.filter(Boolean).map(byte => byte.padStart(2, '0'));
}

function generateRandomMacAddress({ prefix: rawPrefix = '', separator = ':', getRandomByte = () => _.random(0, 255).toString(16).padStart(2, '0') }: { prefix?: string; separator?: string; getRandomByte?: () => string } = {}) {
  const prefix = splitPrefix(rawPrefix);

  const randomBytes = _.times(6 - prefix.length, getRandomByte);
  const bytes = [...prefix, ...randomBytes];

  return bytes.join(separator);
}

function summarizeMacAddressOptions({ prefix: rawPrefix = '', amount = 1 }: MacAddressOptions = {}): MacAddressSummary {
  const prefix = splitPrefix(rawPrefix);
  const warnings: string[] = [];

  if (prefix.length >= 3) {
    warnings.push('Prefix fixes the OUI/vendor portion of the MAC address.');
  }

  if (prefix.length >= 6) {
    warnings.push('Prefix fills the full MAC address; generated values will be identical.');
  }

  return {
    amount,
    prefixBytes: prefix.length,
    randomBytes: Math.max(6 - prefix.length, 0),
    totalBytes: amount * 6,
    warnings,
  };
}
