import { describe, expect, it } from 'vitest';
import { generateLoremIpsum } from './lorem-ipsum-generator.service';

describe('lorem-ipsum-generator service', () => {
  describe('generateLoremIpsum', () => {
    it('starts with "Lorem ipsum" by default', () => {
      const result = generateLoremIpsum({});
      expect(result).toMatch(/^Lorem ipsum/);
    });

    it('does not start with "Lorem ipsum" when startWithLoremIpsum is false', () => {
      const result = generateLoremIpsum({ startWithLoremIpsum: false });
      expect(result).not.toMatch(/^Lorem ipsum/);
    });

    it('generates the correct number of paragraphs', () => {
      const result = generateLoremIpsum({ paragraphCount: 3, sentencePerParagraph: 2, wordCount: 5 });
      const paragraphs = result.split('\n\n');
      expect(paragraphs).toHaveLength(3);
    });

    it('generates a single paragraph by default', () => {
      const result = generateLoremIpsum({});
      expect(result.split('\n\n')).toHaveLength(1);
    });

    it('wraps paragraphs in <p> tags when asHTML is true', () => {
      const result = generateLoremIpsum({ paragraphCount: 2, asHTML: true });
      expect(result).toMatch(/^<p>/);
      expect(result).toContain('</p>');
      // Two paragraphs means two opening tags
      expect((result.match(/<p>/g) ?? []).length).toBe(2);
    });

    it('returns plain text (no HTML) when asHTML is false', () => {
      const result = generateLoremIpsum({ asHTML: false });
      expect(result).not.toContain('<p>');
    });

    it('generates sentences ending with a period', () => {
      const result = generateLoremIpsum({ paragraphCount: 1, sentencePerParagraph: 3, wordCount: 5 });
      const sentences = result.split(' ').filter(w => w.endsWith('.'));
      expect(sentences.length).toBeGreaterThan(0);
    });
  });
});
