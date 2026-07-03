import { colord, extend } from 'colord';
import namesPlugin from 'colord/plugins/names';

extend([namesPlugin]);

export interface ColorContrastResult {
  foreground: string
  background: string
  ratio: number
  ratioText: string
  normalTextAa: boolean
  normalTextAaa: boolean
  largeTextAa: boolean
  largeTextAaa: boolean
  uiComponentAa: boolean
}

export class ColorContrastCheckerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColorContrastCheckerError';
  }
}

function parseColor(input: string) {
  const color = colord(input.trim());

  if (!color.isValid()) {
    throw new ColorContrastCheckerError(`Invalid color "${input}".`);
  }

  const { r, g, b } = color.toRgb();

  return {
    hex: color.toHex(),
    rgb: [r, g, b] as const,
  };
}

function linearizeChannel(value: number) {
  const channel = value / 255;

  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function getRelativeLuminance(input: string) {
  const { rgb: [red, green, blue] } = parseColor(input);

  return 0.2126 * linearizeChannel(red)
    + 0.7152 * linearizeChannel(green)
    + 0.0722 * linearizeChannel(blue);
}

export function getContrastRatio(foreground: string, background: string) {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

export function checkColorContrast(foreground: string, background: string): ColorContrastResult {
  const parsedForeground = parseColor(foreground);
  const parsedBackground = parseColor(background);
  const ratio = Math.round(getContrastRatio(foreground, background) * 100) / 100;

  return {
    foreground: parsedForeground.hex,
    background: parsedBackground.hex,
    ratio,
    ratioText: `${ratio.toFixed(2)}:1`,
    normalTextAa: ratio >= 4.5,
    normalTextAaa: ratio >= 7,
    largeTextAa: ratio >= 3,
    largeTextAaa: ratio >= 4.5,
    uiComponentAa: ratio >= 3,
  };
}
