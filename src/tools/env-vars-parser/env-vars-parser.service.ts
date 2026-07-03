export type EnvOutputFormat = 'json' | 'dotenv' | 'shell' | 'docker-compose';
export type EnvDiagnosticSeverity = 'warning' | 'error';

export interface EnvVariable {
  line: number
  key: string
  value: string
  rawValue: string
  quoted: boolean
  exported: boolean
  comment: string
  warnings: string[]
}

export interface EnvDiagnostic {
  line: number
  severity: EnvDiagnosticSeverity
  message: string
}

export interface EnvParseSummary {
  totalVariables: number
  duplicateKeys: string[]
  emptyValues: string[]
  warningCount: number
  errorCount: number
}

export interface EnvParseResult {
  variables: EnvVariable[]
  diagnostics: EnvDiagnostic[]
  json: Record<string, string | string[]>
  dotenv: string
  shell: string
  dockerCompose: string
  summary: EnvParseSummary
}

export class EnvVarsParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvVarsParserError';
  }
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function splitKeyValue(line: string): [string, string] {
  const delimiterIndex = line.indexOf('=');
  if (delimiterIndex === -1) {
    throw new EnvVarsParserError('Line is missing "=".');
  }

  return [line.slice(0, delimiterIndex).trim(), line.slice(delimiterIndex + 1).trimStart()];
}

function unescapeDoubleQuotedValue(value: string): string {
  return value.replace(/\\([nrt"\\$])/g, (_, escaped: string) => {
    if (escaped === 'n') {
      return '\n';
    }
    if (escaped === 'r') {
      return '\r';
    }
    if (escaped === 't') {
      return '\t';
    }

    return escaped;
  });
}

function parseValue(raw: string): { value: string, rawValue: string, quoted: boolean, comment: string, warnings: string[] } {
  const warnings: string[] = [];
  const trimmed = raw.trimStart();

  if (trimmed.startsWith('"')) {
    const closingIndex = findClosingQuote(trimmed, '"');
    if (closingIndex === -1) {
      throw new EnvVarsParserError('Double-quoted value is not closed.');
    }

    const rawValue = trimmed.slice(0, closingIndex + 1);
    const comment = trimmed.slice(closingIndex + 1).trim();
    return {
      value: unescapeDoubleQuotedValue(trimmed.slice(1, closingIndex)),
      rawValue,
      quoted: true,
      comment,
      warnings,
    };
  }

  if (trimmed.startsWith('\'')) {
    const closingIndex = findClosingQuote(trimmed, '\'');
    if (closingIndex === -1) {
      throw new EnvVarsParserError('Single-quoted value is not closed.');
    }

    const rawValue = trimmed.slice(0, closingIndex + 1);
    const comment = trimmed.slice(closingIndex + 1).trim();
    return {
      value: trimmed.slice(1, closingIndex),
      rawValue,
      quoted: true,
      comment,
      warnings,
    };
  }

  const { value, comment } = splitInlineComment(trimmed);
  if (value.includes(' ')) {
    warnings.push('Unquoted value contains spaces.');
  }

  return {
    value: value.trimEnd(),
    rawValue: value.trimEnd(),
    quoted: false,
    comment,
    warnings,
  };
}

function findClosingQuote(value: string, quote: '"' | '\'') {
  for (let index = 1; index < value.length; index += 1) {
    if (quote === '"' && value[index] === '\\') {
      index += 1;
      continue;
    }

    if (value[index] === quote) {
      return index;
    }
  }

  return -1;
}

function splitInlineComment(value: string): { value: string, comment: string } {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '#' && (index === 0 || /\s/.test(value[index - 1] ?? ''))) {
      return {
        value: value.slice(0, index),
        comment: value.slice(index).trim(),
      };
    }
  }

  return { value, comment: '' };
}

function parseLine(line: string, lineNumber: number): EnvVariable | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine === '' || trimmedLine.startsWith('#')) {
    return undefined;
  }

  const exported = trimmedLine.startsWith('export ');
  const lineWithoutExport = exported ? trimmedLine.slice('export '.length).trimStart() : trimmedLine;
  const [key, rawValueText] = splitKeyValue(lineWithoutExport);
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new EnvVarsParserError(`Invalid environment variable name "${key}".`);
  }

  const parsedValue = parseValue(rawValueText);

  return {
    line: lineNumber,
    key,
    value: parsedValue.value,
    rawValue: parsedValue.rawValue,
    quoted: parsedValue.quoted,
    exported,
    comment: parsedValue.comment,
    warnings: parsedValue.warnings,
  };
}

function appendJsonValue(json: Record<string, string | string[]>, key: string, value: string): void {
  const currentValue = json[key];
  if (currentValue === undefined) {
    json[key] = value;
    return;
  }

  json[key] = Array.isArray(currentValue) ? [...currentValue, value] : [currentValue, value];
}

function quoteDotenvValue(value: string): string {
  if (value === '') {
    return '""';
  }

  if (/[\s#"'\n\r\t]/.test(value)) {
    return `"${value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/"/g, '\\"')}"`;
  }

  return value;
}

function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

function quoteYamlValue(value: string): string {
  return JSON.stringify(value);
}

function buildDotenv(variables: EnvVariable[]) {
  return variables.map(({ key, value }) => `${key}=${quoteDotenvValue(value)}`).join('\n');
}

function buildShell(variables: EnvVariable[]) {
  return variables.map(({ key, value }) => `export ${key}=${quoteShellValue(value)}`).join('\n');
}

function buildDockerCompose(variables: EnvVariable[]) {
  if (variables.length === 0) {
    return 'environment: []';
  }

  return [
    'environment:',
    ...variables.map(({ key, value }) => `  ${key}: ${quoteYamlValue(value)}`),
  ].join('\n');
}

function createDiagnostics(variables: EnvVariable[], parseDiagnostics: EnvDiagnostic[]): EnvDiagnostic[] {
  const diagnostics = [...parseDiagnostics];
  const keyCounts = variables.reduce<Record<string, number>>((counts, { key }) => {
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const duplicateKeys = new Set(Object.entries(keyCounts).filter(([, count]) => count > 1).map(([key]) => key));

  for (const variable of variables) {
    for (const warning of variable.warnings) {
      diagnostics.push({
        line: variable.line,
        severity: 'warning',
        message: warning,
      });
    }

    if (variable.value === '') {
      diagnostics.push({
        line: variable.line,
        severity: 'warning',
        message: `Variable "${variable.key}" has an empty value.`,
      });
    }

    if (duplicateKeys.has(variable.key)) {
      diagnostics.push({
        line: variable.line,
        severity: 'warning',
        message: `Variable "${variable.key}" is defined multiple times.`,
      });
    }
  }

  return diagnostics.sort((left, right) => left.line - right.line || left.message.localeCompare(right.message));
}

export function parseEnvVars(input: string): EnvParseResult {
  const variables: EnvVariable[] = [];
  const parseDiagnostics: EnvDiagnostic[] = [];

  input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      const lineNumber = index + 1;
      try {
        const variable = parseLine(line, lineNumber);
        if (variable) {
          variables.push(variable);
        }
      }
      catch (error) {
        parseDiagnostics.push({
          line: lineNumber,
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

  const diagnostics = createDiagnostics(variables, parseDiagnostics);
  const json: Record<string, string | string[]> = {};
  for (const variable of variables) {
    appendJsonValue(json, variable.key, variable.value);
  }

  const duplicateKeys = Object.entries(variables.reduce<Record<string, number>>((counts, { key }) => {
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {}))
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  return {
    variables,
    diagnostics,
    json,
    dotenv: buildDotenv(variables),
    shell: buildShell(variables),
    dockerCompose: buildDockerCompose(variables),
    summary: {
      totalVariables: variables.length,
      duplicateKeys,
      emptyValues: variables.filter(({ value }) => value === '').map(({ key }) => key),
      warningCount: diagnostics.filter(({ severity }) => severity === 'warning').length,
      errorCount: diagnostics.filter(({ severity }) => severity === 'error').length,
    },
  };
}

export function formatEnvVars(input: string, format: EnvOutputFormat): string {
  const result = parseEnvVars(input);

  if (format === 'json') {
    return JSON.stringify(result.json, null, 2);
  }

  if (format === 'shell') {
    return result.shell;
  }

  if (format === 'docker-compose') {
    return result.dockerCompose;
  }

  return result.dotenv;
}
