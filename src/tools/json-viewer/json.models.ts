import JSON5 from 'json5';

export { sortObjectKeys, formatJson };

function sortObjectKeys<T>(obj: T): T {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys) as unknown as T;
  }

  return Object.keys(obj)
    .sort((a, b) => a.localeCompare(b))
    .reduce((sortedObj, key) => {
      sortedObj[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
      return sortedObj;
    }, {} as Record<string, unknown>) as T;
}

function formatJson({
  rawJson,
  sortKeys = true,
  indentSize = 3,
}: {
  rawJson: string
  sortKeys?: boolean
  indentSize?: number
}) {
  // Parse and format a JSON5 value. Worker callers enforce byte and time limits before returning its output.
  const parsedObject = JSON5.parse(rawJson);

  return JSON.stringify(sortKeys ? sortObjectKeys(parsedObject) : parsedObject, null, indentSize);
}
