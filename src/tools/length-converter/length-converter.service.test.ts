import { describe, expect, it } from 'vitest';
import { convertLength, formatLengthValue, getLengthConversions } from './length-converter.service';

describe('length-converter service', () => {
  it('converts metric units', () => {
    expect(convertLength(1, 'meter', 'centimeter')).toBe(100);
    expect(convertLength(1, 'kilometer', 'meter')).toBe(1000);
  });

  it('converts imperial units', () => {
    expect(convertLength(1, 'foot', 'inch')).toBeCloseTo(12);
    expect(convertLength(1, 'mile', 'foot')).toBeCloseTo(5280);
  });

  it('formats values without noisy trailing zeros', () => {
    expect(formatLengthValue(12.34000000001)).toBe('12.34');
    expect(formatLengthValue(0.000000001)).toBe('1e-9');
  });

  it('returns a conversion row for every unit', () => {
    const conversions = getLengthConversions(1, 'meter');

    expect(conversions).toContainEqual({ unit: 'Meter', symbol: 'm', value: '1' });
    expect(conversions).toContainEqual({ unit: 'Centimeter', symbol: 'cm', value: '100' });
  });
});
