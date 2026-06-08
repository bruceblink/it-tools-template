import JSON5 from 'json5';

export type JsonPathSegment = string | number | '*';

function readBracketSegment(path: string, startIndex: number) {
  let quote: string | undefined;
  let escaped = false;

  for (let index = startIndex + 1; index < path.length; index += 1) {
    const char = path[index] ?? '';

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === ']') {
      return {
        value: path.slice(startIndex + 1, index).trim(),
        endIndex: index,
      };
    }
  }

  throw new Error('Missing closing bracket in JSON path.');
}

function parseQuotedSegment(value: string): string {
  const quote = value[0];
  if ((quote !== '"' && quote !== '\'') || value[value.length - 1] !== quote) {
    return value;
  }

  let result = '';
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index] ?? '';
    if (char === '\\' && index + 1 < value.length - 1) {
      result += value[index + 1] ?? '';
      index += 1;
    }
    else {
      result += char;
    }
  }

  return result;
}

export function tokenizeJsonPath(path: string): JsonPathSegment[] {
  const trimmedPath = path.trim();
  if (trimmedPath === '') {
    throw new Error('JSON path is required.');
  }

  const segments: JsonPathSegment[] = [];
  let index = trimmedPath[0] === '$' ? 1 : 0;

  while (index < trimmedPath.length) {
    const char = trimmedPath[index] ?? '';

    if (char === '.') {
      index += 1;

      if (trimmedPath[index] === '*') {
        segments.push('*');
        index += 1;
        continue;
      }

      const segmentStart = index;
      while (index < trimmedPath.length && trimmedPath[index] !== '.' && trimmedPath[index] !== '[') {
        index += 1;
      }

      const segment = trimmedPath.slice(segmentStart, index).trim();
      if (segment === '') {
        throw new Error('Empty JSON path segment.');
      }

      segments.push(segment);
      continue;
    }

    if (char === '[') {
      const { value, endIndex } = readBracketSegment(trimmedPath, index);

      if (value === '') {
        throw new Error('Empty JSON path segment.');
      }

      if (value === '*') {
        segments.push('*');
      }
      else if (/^-?\d+$/.test(value)) {
        segments.push(Number(value));
      }
      else {
        segments.push(parseQuotedSegment(value));
      }

      index = endIndex + 1;
      continue;
    }

    const segmentStart = index;
    while (index < trimmedPath.length && trimmedPath[index] !== '.' && trimmedPath[index] !== '[') {
      index += 1;
    }

    const segment = trimmedPath.slice(segmentStart, index).trim();
    if (segment === '') {
      throw new Error('Empty JSON path segment.');
    }

    segments.push(segment);
  }

  return segments;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function queryJsonPath(value: unknown, path: string): unknown[] {
  const segments = tokenizeJsonPath(path);

  return segments.reduce<unknown[]>((currentValues, segment) => {
    const nextValues: unknown[] = [];

    for (const currentValue of currentValues) {
      if (segment === '*') {
        if (Array.isArray(currentValue)) {
          nextValues.push(...currentValue);
        }
        else if (isObjectLike(currentValue)) {
          nextValues.push(...Object.values(currentValue));
        }
        continue;
      }

      if (typeof segment === 'number') {
        if (Array.isArray(currentValue)) {
          const index = segment < 0 ? currentValue.length + segment : segment;
          if (index >= 0 && index < currentValue.length) {
            nextValues.push(currentValue[index]);
          }
        }
        else if (isObjectLike(currentValue) && Object.prototype.hasOwnProperty.call(currentValue, String(segment))) {
          nextValues.push(currentValue[String(segment)]);
        }
        continue;
      }

      if (isObjectLike(currentValue) && Object.prototype.hasOwnProperty.call(currentValue, segment)) {
        nextValues.push(currentValue[segment]);
      }
    }

    return nextValues;
  }, [value]);
}

export function extractJsonPath(rawJson: string, path: string): string {
  if (rawJson === '') {
    return '';
  }

  const segments = tokenizeJsonPath(path);
  const matches = queryJsonPath(JSON5.parse(rawJson), path);

  if (matches.length === 0) {
    return '';
  }

  const result = segments.includes('*') ? matches : matches[0];
  const serialized = JSON.stringify(result, null, 2);

  return serialized ?? String(result);
}
