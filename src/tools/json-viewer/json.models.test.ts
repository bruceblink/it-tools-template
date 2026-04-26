import { describe, expect, it } from 'vitest';
import { formatJson, sortObjectKeys } from './json.models';

describe('json models', () => {
  describe('sortObjectKeys', () => {
    it('the object keys are recursively sorted alphabetically', () => {
      expect(JSON.stringify(sortObjectKeys({ b: 2, a: 1 }))).to.deep.equal(JSON.stringify({ a: 1, b: 2 }));
      // To unsure that this way of testing is working
      expect(JSON.stringify(sortObjectKeys({ b: 2, a: 1 }))).to.not.deep.equal(JSON.stringify({ b: 2, a: 1 }));

      expect(JSON.stringify(sortObjectKeys({ b: 2, a: 1, d: { j: 7, a: [{ z: 9, y: 8 }] }, c: 3 }))).to.deep.equal(
        JSON.stringify({ a: 1, b: 2, c: 3, d: { a: [{ y: 8, z: 9 }], j: 7 } }),
      );
    });
  });

  describe('formatJson', () => {
    it('formats JSON with default indent of 3', () => {
      const result = formatJson({ rawJson: '{"a":1}' });
      expect(result).toBe('{\n   "a": 1\n}');
    });

    it('sorts keys alphabetically by default', () => {
      const result = formatJson({ rawJson: '{"z":2,"a":1}' });
      const aIndex = result.indexOf('"a"');
      const zIndex = result.indexOf('"z"');
      expect(aIndex).toBeLessThan(zIndex);
    });

    it('preserves original key order when sortKeys is false', () => {
      const result = formatJson({ rawJson: '{"z":2,"a":1}', sortKeys: false });
      const aIndex = result.indexOf('"a"');
      const zIndex = result.indexOf('"z"');
      expect(zIndex).toBeLessThan(aIndex);
    });

    it('respects custom indent size', () => {
      const result = formatJson({ rawJson: '{"a":1}', sortKeys: false, indentSize: 2 });
      expect(result).toBe('{\n  "a": 1\n}');
    });

    it('parses JSON5 with trailing commas', () => {
      const result = formatJson({ rawJson: '{"a":1,}', sortKeys: false });
      expect(result).toBe('{\n   "a": 1\n}');
    });

    it('parses JSON5 with comments', () => {
      const result = formatJson({ rawJson: '{"a":1 /* comment */}', sortKeys: false });
      expect(result).toBe('{\n   "a": 1\n}');
    });

    it('throws on invalid JSON5', () => {
      expect(() => formatJson({ rawJson: '{invalid' })).toThrow();
    });

    it('handles arrays', () => {
      const result = formatJson({ rawJson: '[3,1,2]', sortKeys: false });
      expect(result).toBe('[\n   3,\n   1,\n   2\n]');
    });
  });
});
