import xmlFormat, { type XMLFormatterOptions } from 'xml-formatter';
import { withDefaultOnError } from '@/utils/defaults';

export { formatXml, formatXmlResult, isValidXML };

function cleanRawXml(rawXml: string): string {
  return rawXml.trim();
}

function formatXml(rawXml: string, options?: XMLFormatterOptions): string {
  return withDefaultOnError(() => xmlFormat(cleanRawXml(rawXml), options) ?? '', '');
}

function formatXmlResult(rawXml: string, options?: XMLFormatterOptions): { valid: boolean; output: string } {
  const cleanedRawXml = cleanRawXml(rawXml);
  if (cleanedRawXml === '') {
    return { valid: true, output: '' };
  }

  try {
    return { valid: true, output: xmlFormat(cleanedRawXml, options) ?? '' };
  }
  catch {
    return { valid: false, output: '' };
  }
}

function isValidXML(rawXml: string): boolean {
  return formatXmlResult(rawXml).valid;
}
