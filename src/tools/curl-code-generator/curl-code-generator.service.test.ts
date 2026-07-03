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

  it('accepts long option assignments and --url commands', () => {
    expect(parseCurlCommand('curl --url=https://example.com --request=PUT --header=Accept:application/json --data-raw=\'{"ok":true}\'')).toMatchObject({
      url: 'https://example.com',
      method: 'PUT',
      headers: [
        { name: 'Accept', value: 'application/json' },
      ],
      data: '{"ok":true}',
    });
    expect(parseCurlCommand('curl --url https://example.com')).toMatchObject({
      url: 'https://example.com',
      method: 'GET',
    });
    expect(parseCurlCommand('curl --user=user:pass --url=https://example.com').headers).toEqual([
      { name: 'Authorization', value: 'Basic dXNlcjpwYXNz' },
    ]);
  });

  it('moves data flags into the URL when -G or --get is used', () => {
    expect(parseCurlCommand('curl -G https://api.example.com/search -d q=hello -d page=1')).toMatchObject({
      url: 'https://api.example.com/search?q=hello&page=1',
      method: 'GET',
      data: '',
    });
    expect(parseCurlCommand('curl --get "https://api.example.com/search?lang=en#results" --data-urlencode "q=hello world"')).toMatchObject({
      url: 'https://api.example.com/search?lang=en&q=hello%20world#results',
      method: 'GET',
      data: '',
    });
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

  it('generates code with query parameters for -G commands', () => {
    const generation = generateCurlCode('curl -G https://api.example.com/search -H "Accept: application/json" --data-urlencode "q=hello world" -d page=1');

    expect(generation.fetch).toContain('fetch("https://api.example.com/search?q=hello%20world&page=1"');
    expect(generation.axios).toContain('url: "https://api.example.com/search?q=hello%20world&page=1"');
    expect(generation.httpie).toContain("'https://api.example.com/search?q=hello%20world&page=1'");
    expect(generation.summary).toEqual({
      method: 'GET',
      headerCount: 1,
      hasBody: false,
      warningCount: 0,
    });
  });

  it('reports unsupported options as warnings', () => {
    const request = parseCurlCommand('curl --location --retry 3 https://example.com');
    const assignmentRequest = parseCurlCommand('curl --retry=3 https://example.com');

    expect(request.url).toBe('https://example.com');
    expect(request.warnings).toEqual([
      'Option --location was ignored.',
      'Unsupported option --retry was ignored.',
    ]);
    expect(assignmentRequest.url).toBe('https://example.com');
    expect(assignmentRequest.warnings).toEqual([
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
