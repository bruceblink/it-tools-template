interface SvgPlaceholderOptions {
  width: number;
  height: number;
  fontSize: number;
  backgroundColor: string;
  textColor: string;
  text: string;
  useExactSize: boolean;
}

const hexColorPattern = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

function formatPositiveNumber(value: number, name: string) {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${name} must be a finite number greater than or equal to 1`);
  }

  return String(value);
}

function validateHexColor(value: string, name: string) {
  if (!hexColorPattern.test(value)) {
    throw new TypeError(`${name} must be a hexadecimal color`);
  }

  return value;
}

function escapeXmlText(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character] ?? character,
  );
}

/** Builds an SVG placeholder from validated attributes and escaped text content. */
export function buildSvgPlaceholder({
  width,
  height,
  fontSize,
  backgroundColor,
  textColor,
  text,
  useExactSize,
}: SvgPlaceholderOptions) {
  const safeWidth = formatPositiveNumber(width, 'Width');
  const safeHeight = formatPositiveNumber(height, 'Height');
  const safeFontSize = formatPositiveNumber(fontSize, 'Font size');
  const safeBackgroundColor = validateHexColor(backgroundColor, 'Background color');
  const safeTextColor = validateHexColor(textColor, 'Text color');
  const size = useExactSize ? ` width="${safeWidth}" height="${safeHeight}"` : '';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${safeWidth} ${safeHeight}"${size}>
  <rect width="${safeWidth}" height="${safeHeight}" fill="${safeBackgroundColor}"></rect>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="${safeFontSize}px" fill="${safeTextColor}">${escapeXmlText(text)}</text>
</svg>
  `.trim();
}
