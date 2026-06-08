import JSON5 from 'json5';

export interface JsonKeySorterOptions {
  recursive?: boolean
  descending?: boolean
  indentSize?: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function sortJsonKeys(value: unknown, options: JsonKeySorterOptions = {}): unknown {
  const recursive = options.recursive ?? true;
  const descending = options.descending ?? false;

  if (Array.isArray(value)) {
    return recursive ? value.map(item => sortJsonKeys(item, options)) : value;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sortedKeys = Object.keys(value).sort((left, right) =>
    descending ? right.localeCompare(left) : left.localeCompare(right),
  );

  return Object.fromEntries(sortedKeys.map(key => [
    key,
    recursive ? sortJsonKeys(value[key], options) : value[key],
  ]));
}

export function sortJsonText(input: string, options: JsonKeySorterOptions = {}): string {
  if (input === '') {
    return '';
  }

  const indentSize = options.indentSize ?? 2;
  return JSON.stringify(sortJsonKeys(JSON5.parse(input), options), null, indentSize);
}
