export interface ParsedUrlParameter {
  key: string
  value: string
}

export interface ParsedUrlSummary {
  pathSegments: number
  queryParameters: number
  uniqueParameterNames: number
  duplicateParameterNames: number
}

export interface ParsedUrlDetails {
  href: string
  protocol: string
  username: string
  password: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  origin: string
  parameters: ParsedUrlParameter[]
  duplicateParameterNames: string[]
  summary: ParsedUrlSummary
  warnings: string[]
}

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

function hasExplicitDefaultPort(input: string, url: URL): boolean {
  const defaultPort = DEFAULT_PORTS[url.protocol];
  if (!defaultPort) {
    return false;
  }

  return new RegExp(`^${url.protocol.replace(':', '')}:\\/\\/[^/?#]*:${defaultPort}(?:[/?#]|$)`, 'i').test(input);
}

export function parseUrlDetails(input: string): ParsedUrlDetails {
  const url = new URL(input);
  const parameters = Array.from(url.searchParams.entries()).map(([key, value]) => ({ key, value }));
  const parameterCounts = parameters.reduce<Record<string, number>>((counts, { key }) => {
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const duplicateParameterNames = Object.entries(parameterCounts)
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  const pathSegments = url.pathname
    .split('/')
    .filter(Boolean)
    .length;
  const warnings: string[] = [];

  if (url.username || url.password) {
    warnings.push('URL contains embedded credentials.');
  }

  if (hasExplicitDefaultPort(input, url)) {
    warnings.push('URL explicitly includes the default port for its protocol.');
  }

  if (duplicateParameterNames.length > 0) {
    warnings.push(`Duplicate query parameters: ${duplicateParameterNames.join(', ')}.`);
  }

  return {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    parameters,
    duplicateParameterNames,
    summary: {
      pathSegments,
      queryParameters: parameters.length,
      uniqueParameterNames: Object.keys(parameterCounts).length,
      duplicateParameterNames: duplicateParameterNames.length,
    },
    warnings,
  };
}
