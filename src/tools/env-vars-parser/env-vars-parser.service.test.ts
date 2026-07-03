import { describe, expect, it } from 'vitest';
import { formatEnvVars, parseEnvVars } from './env-vars-parser.service';

describe('env-vars-parser service', () => {
  it('parses dotenv variables with comments, exports, and quotes', () => {
    const result = parseEnvVars([
      '# app config',
      'APP_ENV=production',
      'export API_URL="https://example.com/api?x=1#tag" # public API',
      'SECRET_KEY=\'abc#123\'',
      'EMPTY=',
    ].join('\n'));

    expect(result.variables).toMatchObject([
      {
        line: 2,
        key: 'APP_ENV',
        value: 'production',
        rawValue: 'production',
        quoted: false,
        exported: false,
      },
      {
        line: 3,
        key: 'API_URL',
        value: 'https://example.com/api?x=1#tag',
        rawValue: '"https://example.com/api?x=1#tag"',
        quoted: true,
        exported: true,
        comment: '# public API',
      },
      {
        line: 4,
        key: 'SECRET_KEY',
        value: 'abc#123',
        quoted: true,
      },
      {
        line: 5,
        key: 'EMPTY',
        value: '',
      },
    ]);
    expect(result.summary).toMatchObject({
      totalVariables: 4,
      emptyValues: ['EMPTY'],
      warningCount: 1,
      errorCount: 0,
    });
  });

  it('handles common double-quoted escape sequences', () => {
    expect(parseEnvVars('TEXT="hello\\nworld\\t!"').variables[0]).toMatchObject({
      key: 'TEXT',
      value: 'hello\nworld\t!',
    });
  });

  it('reports invalid lines without dropping valid variables', () => {
    const result = parseEnvVars([
      'GOOD=value',
      'BAD-NAME=value',
      'MISSING_VALUE',
      'UNCLOSED="value',
    ].join('\n'));

    expect(result.variables).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      {
        line: 2,
        severity: 'error',
        message: 'Invalid environment variable name "BAD-NAME".',
      },
      {
        line: 3,
        severity: 'error',
        message: 'Line is missing "=".',
      },
      {
        line: 4,
        severity: 'error',
        message: 'Double-quoted value is not closed.',
      },
    ]);
    expect(result.summary.errorCount).toBe(3);
  });

  it('warns about duplicates and unquoted spaces', () => {
    const result = parseEnvVars([
      'DATABASE_URL=postgres://localhost/app',
      'DATABASE_URL=postgres://localhost/other',
      'DISPLAY_NAME=My App',
    ].join('\n'));

    expect(result.summary.duplicateKeys).toEqual(['DATABASE_URL']);
    expect(result.diagnostics.map(({ line, severity, message }) => ({ line, severity, message }))).toEqual([
      {
        line: 1,
        severity: 'warning',
        message: 'Variable "DATABASE_URL" is defined multiple times.',
      },
      {
        line: 2,
        severity: 'warning',
        message: 'Variable "DATABASE_URL" is defined multiple times.',
      },
      {
        line: 3,
        severity: 'warning',
        message: 'Unquoted value contains spaces.',
      },
    ]);
    expect(result.json).toEqual({
      DATABASE_URL: ['postgres://localhost/app', 'postgres://localhost/other'],
      DISPLAY_NAME: 'My App',
    });
  });

  it('formats variables for JSON, dotenv, shell, and Docker Compose', () => {
    const input = [
      'APP_ENV=production',
      'APP_NAME="My App"',
      'SECRET=it\'s-safe',
    ].join('\n');

    expect(formatEnvVars(input, 'json')).toBe(JSON.stringify({
      APP_ENV: 'production',
      APP_NAME: 'My App',
      SECRET: 'it\'s-safe',
    }, null, 2));
    expect(formatEnvVars(input, 'dotenv')).toBe([
      'APP_ENV=production',
      'APP_NAME="My App"',
      'SECRET="it\'s-safe"',
    ].join('\n'));
    expect(formatEnvVars(input, 'shell')).toBe([
      'export APP_ENV=\'production\'',
      'export APP_NAME=\'My App\'',
      'export SECRET=\'it\'\\\'\'s-safe\'',
    ].join('\n'));
    expect(formatEnvVars(input, 'docker-compose')).toBe([
      'environment:',
      '  APP_ENV: "production"',
      '  APP_NAME: "My App"',
      '  SECRET: "it\'s-safe"',
    ].join('\n'));
  });
});
