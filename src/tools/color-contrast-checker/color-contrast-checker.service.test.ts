import { describe, expect, it } from 'vitest';
import {
  ColorContrastCheckerError,
  checkColorContrast,
  getContrastRatio,
  getRelativeLuminance,
} from './color-contrast-checker.service';

describe('color-contrast-checker service', () => {
  it('calculates relative luminance for black and white', () => {
    expect(getRelativeLuminance('#000000')).toBe(0);
    expect(getRelativeLuminance('#ffffff')).toBe(1);
  });

  it('calculates the maximum contrast ratio', () => {
    expect(getContrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
  });

  it('normalizes colors and returns WCAG pass states', () => {
    expect(checkColorContrast('#111827', '#ffffff')).toMatchObject({
      foreground: '#111827',
      background: '#ffffff',
      ratio: 17.74,
      ratioText: '17.74:1',
      normalTextAa: true,
      normalTextAaa: true,
      largeTextAa: true,
      largeTextAaa: true,
      uiComponentAa: true,
    });
  });

  it('marks low contrast color pairs as failing', () => {
    expect(checkColorContrast('#777777', '#999999')).toMatchObject({
      ratio: 1.57,
      normalTextAa: false,
      normalTextAaa: false,
      largeTextAa: false,
      largeTextAaa: false,
      uiComponentAa: false,
    });
  });

  it('accepts CSS color names', () => {
    expect(checkColorContrast('black', 'white')).toMatchObject({
      foreground: '#000000',
      background: '#ffffff',
      ratioText: '21.00:1',
    });
  });

  it('rejects invalid colors', () => {
    expect(() => checkColorContrast('not-a-color', '#fff')).toThrow(ColorContrastCheckerError);
  });
});
