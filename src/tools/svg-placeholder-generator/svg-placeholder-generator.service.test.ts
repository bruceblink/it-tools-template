import { describe, expect, it } from 'vitest';
import { buildSvgPlaceholder } from './svg-placeholder-generator.service';

const defaults = {
  width: 600,
  height: 350,
  fontSize: 26,
  backgroundColor: '#cccccc',
  textColor: '#333333',
  text: '600x350',
  useExactSize: true,
};

describe('buildSvgPlaceholder', () => {
  it('preserves ordinary text, dimensions, colors, and optional exact sizing', () => {
    const svg = buildSvgPlaceholder({ ...defaults, text: 'Preview' });

    expect(svg).toContain('viewBox="0 0 600 350" width="600" height="350"');
    expect(svg).toContain('fill="#cccccc"');
    expect(svg).toContain('font-size="26px" fill="#333333">Preview</text>');
    expect(buildSvgPlaceholder({ ...defaults, useExactSize: false })).not.toMatch(/<svg[^>]*\swidth=/);
  });

  it('escapes XML markup in user text so it remains text in the downloaded SVG', () => {
    const maliciousText = '</text><script>alert(1)</script><text>& "quoted" \'apostrophe\'';
    const svg = buildSvgPlaceholder({ ...defaults, text: maliciousText });

    expect(svg).not.toMatch(/<script\b/i);
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;text&gt;');
    expect(svg).toContain('&amp; &quot;quoted&quot; &apos;apostrophe&apos;');
  });

  it('rejects non-finite, too-small, and non-numeric dimensions', () => {
    expect(() => buildSvgPlaceholder({ ...defaults, width: Number.NaN })).toThrow(/Width/);
    expect(() => buildSvgPlaceholder({ ...defaults, height: 0 })).toThrow(/Height/);
    expect(() => buildSvgPlaceholder({ ...defaults, fontSize: Number.POSITIVE_INFINITY })).toThrow(/Font size/);
  });

  it('rejects non-hex colors before inserting them into SVG attributes', () => {
    expect(() => buildSvgPlaceholder({ ...defaults, backgroundColor: '"/><script>' })).toThrow(/Background color/);
    expect(() => buildSvgPlaceholder({ ...defaults, textColor: 'red' })).toThrow(/Text color/);
  });
});
