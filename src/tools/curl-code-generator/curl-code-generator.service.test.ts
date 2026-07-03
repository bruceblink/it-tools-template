import { describe, expect, it } from 'vitest';
import { CurlCodeGeneratorError, formatCurlCode, generateCurlCode, parseCurlCommand } from './curl-code-generator.service';

describe('curl-code-generator service', () => {
  it('parses a JSON POST cURL command', () => {
    expect(parseCurlCommand(`curl 'https://api.example.com/users' \\
      -X POST \\
      -H 'Content-Type: application/json' \\
      -H 'Authorization: Bearer token' \\
      --data-raw '{"name":"Ada"}'`)).toEqual({
      url: 'https://api.example.com/users',
      method: 'POST',
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer token' },
      ],
      data: '{"name":"Ada"}',
      compressed: false,
      warnings: [],
    });
  });

  it('infers POST when data is present and GET otherwise', () => {
    expect(parseCurlCommand('curl https://example.com').method).toBe('GET');
    expect(parseCurlCommand('curl https://example.com -d a=1').method).toBe('POST');
  });

  it('converts basic auth credentials to an Authorization header', () => {
    expect(parseCurlCommand('curl -u user:pass https://example.com').headers).toEqual([
      { name: 'Authorization', value: 'Basic dXNlcjpwYXNz' },
    ]);
  });

  it('generates fetch, axios, and HTTPie commands', () => {
    const generation = generateCurlCode(`curl https://api.example.com/items -H 'Accept: application/json' -d 'page=1'`);

    expect(generation.fetch).toBe([
      'const response = await fetch("https://api.example.com/items", {',
      '  method: "POST",',
      '  headers: {',
      '    "Accept": "application/json",',
      '  },',
      '  body: "page=1"',
      '});',
      '',
      'const data = await response.text();',
      'console.log(data);',
    ].join('\n'));
    expect(generation.axios).toBe([
      'const response = await axios({',
      '  method: "post",',
      '  url: "https://api.example.com/items",',
      '  headers: {',
      '    "Accept": "application/json",',
      '  },',
      '  data: "page=1",',
      '});',
      '',
      'console.log(response.data);',
    ].join('\n'));
    expect(generation.httpie).toBe([
      'http \\',
      '  POST \\',
      '  \'https://api.example.com/items\' \\',
      '  \'Accept:application/json\' \\',
      '  <<< \'page=1\'',
    ].join('\n'));
  });

  it('reports unsupported options as warnings', () => {
    const request = parseCurlCommand('curl --location --retry 3 https://example.com');

    expect(request.url).toBe('https://example.com');
    expect(request.warnings).toEqual([
      'Option --location was ignored.',
      'Unsupported option --retry was ignored.',
    ]);
  });

  it('throws on invalid commands', () => {
    expect(() => parseCurlCommand('wget https://example.com')).toThrow(CurlCodeGeneratorError);
    expect(() => parseCurlCommand('curl -H')).toThrow('-H is missing a value.');
    expect(() => parseCurlCommand('curl -H invalid https://example.com')).toThrow('Invalid header "invalid".');
    expect(() => parseCurlCommand('curl "https://example.com')).toThrow('Shell quote is not closed.');
  });

  it('formats a single selected output', () => {
    expect(formatCurlCode('curl https://example.com', 'fetch')).toContain('fetch("https://example.com"');
    expect(formatCurlCode('curl https://example.com', 'axios')).toContain('axios({');
    expect(formatCurlCode('curl https://example.com', 'httpie')).toBe('http \\\n  GET \\\n  \'https://example.com\'');
  });
});
