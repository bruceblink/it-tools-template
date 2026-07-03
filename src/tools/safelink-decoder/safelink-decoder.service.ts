export interface ParsedSafeLinksUrl {
  originalUrl: string
  decodedUrl: string
  host: string
  data: string
  sdata: string
  reserved: string
  warnings: string[]
}

function isOutlookSafeLinksHost(host: string): boolean {
  return host.toLowerCase().endsWith('.safelinks.protection.outlook.com');
}

export function parseSafeLinksURL(safeLinksUrl: string): ParsedSafeLinksUrl {
  const parsedUrl = new URL(safeLinksUrl);
  if (!isOutlookSafeLinksHost(parsedUrl.host)) {
    throw new Error('Invalid SafeLinks URL provided');
  }

  const decodedUrl = parsedUrl.searchParams.get('url') ?? '';
  if (!decodedUrl) {
    throw new Error('SafeLinks URL is missing the target url parameter');
  }

  const data = parsedUrl.searchParams.get('data') ?? '';
  const sdata = parsedUrl.searchParams.get('sdata') ?? '';
  const reserved = parsedUrl.searchParams.get('reserved') ?? '';
  const warnings: string[] = [];

  if (!data) {
    warnings.push('Missing data parameter.');
  }

  if (!sdata) {
    warnings.push('Missing sdata signature parameter.');
  }

  if (reserved && reserved !== '0') {
    warnings.push('Reserved parameter has an unexpected value.');
  }

  return {
    originalUrl: safeLinksUrl,
    decodedUrl,
    host: parsedUrl.host,
    data,
    sdata,
    reserved,
    warnings,
  };
}

export function decodeSafeLinksURL(safeLinksUrl: string) {
  return parseSafeLinksURL(safeLinksUrl).decodedUrl;
}
