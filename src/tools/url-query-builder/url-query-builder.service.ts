export interface QueryParameter {
  key: string
  value: string
}

export interface QueryBuilderOptions {
  includeEmptyValues?: boolean
  sortKeys?: boolean
}

function appendJsonValue(params: QueryParameter[], key: string, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(item => appendJsonValue(params, key, item));
    return;
  }

  if (value === null || value === undefined) {
    params.push({ key, value: '' });
    return;
  }

  if (typeof value === 'object') {
    params.push({ key, value: JSON.stringify(value) });
    return;
  }

  params.push({ key, value: String(value) });
}

function parseJsonParameters(input: string): QueryParameter[] {
  const parsed = JSON.parse(input) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON parameter input must be an object.');
  }

  const params: QueryParameter[] = [];
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => appendJsonValue(params, key, value));

  return params;
}

function parseQueryString(input: string): QueryParameter[] {
  const queryStartIndex = input.indexOf('?');
  const hashStartIndex = input.indexOf('#');
  const query = (queryStartIndex === -1 ? input : input.slice(queryStartIndex + 1))
    .replace(/^\?/, '')
    .slice(0, hashStartIndex === -1 || queryStartIndex > hashStartIndex ? undefined : hashStartIndex - queryStartIndex - 1);

  return Array.from(new URLSearchParams(query).entries()).map(([key, value]) => ({ key, value }));
}

function parseLineParameters(input: string): QueryParameter[] {
  return input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const equalsIndex = line.indexOf('=');
      const colonIndex = line.indexOf(':');
      const separatorIndex = equalsIndex >= 0 ? equalsIndex : colonIndex;

      if (separatorIndex === -1) {
        return { key: line.trim(), value: '' };
      }

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    });
}

export function parseQueryParameters(input: string): QueryParameter[] {
  const trimmedInput = input.trim();

  if (trimmedInput === '') {
    return [];
  }

  if (trimmedInput.startsWith('{')) {
    return parseJsonParameters(trimmedInput);
  }

  if (!trimmedInput.includes('\n') && (trimmedInput.includes('&') || trimmedInput.startsWith('?') || trimmedInput.includes('?'))) {
    return parseQueryString(trimmedInput);
  }

  return parseLineParameters(trimmedInput);
}

export function buildQueryString(input: string, options: QueryBuilderOptions = {}): string {
  const includeEmptyValues = options.includeEmptyValues ?? true;
  const sortKeys = options.sortKeys ?? false;
  const params = parseQueryParameters(input)
    .filter(({ key, value }) => key !== '' && (includeEmptyValues || value !== ''));

  if (sortKeys) {
    params.sort((left, right) => left.key.localeCompare(right.key) || left.value.localeCompare(right.value));
  }

  const searchParams = new URLSearchParams();
  params.forEach(({ key, value }) => searchParams.append(key, value));

  return searchParams.toString();
}

export function buildUrlWithQuery(baseUrl: string, input: string, options: QueryBuilderOptions = {}): string {
  const queryString = buildQueryString(input, options);
  const trimmedBaseUrl = baseUrl.trim();

  if (queryString === '') {
    return trimmedBaseUrl;
  }

  if (trimmedBaseUrl === '') {
    return `?${queryString}`;
  }

  const hashIndex = trimmedBaseUrl.indexOf('#');
  const urlWithoutHash = hashIndex === -1 ? trimmedBaseUrl : trimmedBaseUrl.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : trimmedBaseUrl.slice(hashIndex);
  const separator = urlWithoutHash.includes('?')
    ? (urlWithoutHash.endsWith('?') || urlWithoutHash.endsWith('&') ? '' : '&')
    : '?';

  return `${urlWithoutHash}${separator}${queryString}${hash}`;
}
