export interface ParsedSafeLinksUrl {
  originalUrl: string
  decodedUrl: string
  host: string
  targetProtocol: string
  targetHost: string
  targetPath: string
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

  const targetUrl = new URL(decodedUrl);
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

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    warnings.push('Decoded URL uses a non-HTTP(S) protocol.');
  }
  else if (targetUrl.protocol !== 'https:') {
    warnings.push('Decoded URL is not HTTPS.');
  }

  return {
    originalUrl: safeLinksUrl,
    decodedUrl,
    host: parsedUrl.host,
    targetProtocol: targetUrl.protocol,
    targetHost: targetUrl.host,
    targetPath: `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`,
    data,
    sdata,
    reserved,
    warnings,
  };
}

export function decodeSafeLinksURL(safeLinksUrl: string) {
  return parseSafeLinksURL(safeLinksUrl).decodedUrl;
}
