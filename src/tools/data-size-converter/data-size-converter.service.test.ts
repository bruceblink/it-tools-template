import { describe, expect, it } from 'vitest';
import { convertDataSize, formatDataSizeValue, getDataSizeConversions } from './data-size-converter.service';

describe('data-size-converter service', () => {
  it('converts between decimal and binary byte units', () => {
    expect(convertDataSize(1, 'megabyte', 'kilobyte')).toBe(1000);
    expect(convertDataSize(1, 'mebibyte', 'kibibyte')).toBe(1024);
  });

  it('converts bytes to bits', () => {
    expect(convertDataSize(1, 'byte', 'bit')).toBe(8);
    expect(convertDataSize(8, 'bit', 'byte')).toBe(1);
  });

  it('formats values without noisy trailing zeros', () => {
    expect(formatDataSizeValue(1.50000000001)).toBe('1.5');
    expect(formatDataSizeValue(0)).toBe('0');
    expect(formatDataSizeValue(0.000000001)).toBe('1e-9');
  });

  it('returns a conversion row for every unit', () => {
    const conversions = getDataSizeConversions(1, 'byte');

    expect(conversions).toContainEqual({ unit: 'Bit', symbol: 'b', value: '8' });
    expect(conversions).toContainEqual({ unit: 'Byte', symbol: 'B', value: '1' });
  });
});
