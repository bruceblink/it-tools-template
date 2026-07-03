import { describe, expect, it } from 'vitest';
import {
  generateSriHashes,
  generateSriHtmlSnippet,
  joinIntegrity,
  summarizeSriOptions,
} from './sri-hash-generator.service';

describe('sri-hash-generator service', () => {
  it('generates SRI hashes with base64 digests', () => {
    expect(generateSriHashes('console.log("hello");', ['sha256', 'sha384', 'sha512'])).toEqual([
      {
        algorithm: 'sha256',
        digest: 'N4H5TqgSuzNDfekEngS8OvQaDnOXFksFc3nAjDsKxIk=',
        integrity: 'sha256-N4H5TqgSuzNDfekEngS8OvQaDnOXFksFc3nAjDsKxIk=',
      },
      {
        algorithm: 'sha384',
        digest: 'ym/3cF/gAcW1/eerNQGFaOSOuU2LHI6RYvChaVur/G+PkVozZ5Zo8Uu5R2S2zm7C',
        integrity: 'sha384-ym/3cF/gAcW1/eerNQGFaOSOuU2LHI6RYvChaVur/G+PkVozZ5Zo8Uu5R2S2zm7C',
      },
      {
        algorithm: 'sha512',
        digest: 'c5g0DxEoVwcCaB+QWnJdD75P2yC4xvGgTcS1WLgjrZc1zSzhcJ/U4kP4y92KvrbcUU9c+9GM73aMcrLd/z94vQ==',
        integrity: 'sha512-c5g0DxEoVwcCaB+QWnJdD75P2yC4xvGgTcS1WLgjrZc1zSzhcJ/U4kP4y92KvrbcUU9c+9GM73aMcrLd/z94vQ==',
      },
    ]);
  });

  it('deduplicates selected algorithms', () => {
    expect(generateSriHashes('hello', ['sha384', 'sha384']).map(({ algorithm }) => algorithm)).toEqual(['sha384']);
  });

  it('joins integrity values for the attribute', () => {
    const hashes = generateSriHashes('hello', ['sha256', 'sha384']);

    expect(joinIntegrity(hashes)).toBe(`${hashes[0]?.integrity} ${hashes[1]?.integrity}`);
  });

  it('generates script and stylesheet snippets', () => {
    expect(generateSriHtmlSnippet({
      type: 'script',
      url: 'https://cdn.example.com/app.js',
      integrity: 'sha384-test',
      crossorigin: 'anonymous',
    })).toBe('<script src="https://cdn.example.com/app.js" integrity="sha384-test" crossorigin="anonymous"></script>');

    expect(generateSriHtmlSnippet({
      type: 'stylesheet',
      url: 'https://cdn.example.com/app.css',
      integrity: 'sha384-test',
      crossorigin: 'none',
    })).toBe('<link rel="stylesheet" href="https://cdn.example.com/app.css" integrity="sha384-test">');
  });

  it('escapes snippet attributes', () => {
    expect(generateSriHtmlSnippet({
      type: 'script',
      url: 'https://cdn.example.com/app.js?name="x"&debug=<yes>',
      integrity: 'sha384-"hash"&value',
      crossorigin: 'use-credentials',
    })).toContain('src="https://cdn.example.com/app.js?name=&quot;x&quot;&amp;debug=&lt;yes&gt;"');
  });

  it('returns no snippet when url or integrity is missing', () => {
    expect(generateSriHtmlSnippet({ type: 'script', url: '', integrity: 'sha384-test' })).toBe('');
    expect(generateSriHtmlSnippet({ type: 'script', url: 'https://example.com/app.js', integrity: '' })).toBe('');
  });

  it('summarizes SRI options', () => {
    expect(summarizeSriOptions({
      content: 'hello',
      url: 'https://cdn.example.com/app.js',
      algorithms: ['sha384', 'sha384'],
      integrity: 'sha384-test',
    })).toEqual({
      contentBytes: 5,
      algorithmCount: 1,
      integrityLength: 11,
      warnings: [],
    });
  });

  it('warns about incomplete or weaker SRI options', () => {
    expect(summarizeSriOptions({
      content: '',
      url: '',
      algorithms: ['sha256'],
      integrity: '',
    })).toEqual({
      contentBytes: 0,
      algorithmCount: 1,
      integrityLength: 0,
      warnings: [
        'Resource content is empty.',
        'Resource URL is empty; HTML snippet cannot be generated.',
        'Prefer SHA-384 or SHA-512 for new SRI hashes.',
      ],
    });
  });
});
