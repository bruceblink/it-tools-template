import { tool as cspAnalyzer } from '@/tools/csp-analyzer';
import { tool as corsAnalyzer } from '@/tools/cors-analyzer';
import { tool as csvToJson } from '@/tools/csv-to-json';
import { tool as httpHeadersParser } from '@/tools/http-headers-parser';
import { tool as httpStatusCodes } from '@/tools/http-status-codes';
import { tool as jsonLinesConverter } from '@/tools/json-lines-converter';
import { tool as jsonToCsv } from '@/tools/json-to-csv';
import { tool as macAddressLookup } from '@/tools/mac-address-lookup';
import { tool as mimeTypes } from '@/tools/mime-types';
import type { ExtensionToolCategory } from '../extension.types';
import {
  dataConversionExtensionId,
  networkSecurityExtensionId,
  offlineReferenceExtensionId,
} from './sample-ids';
import { scopeTool, type ExtensionToolMetadata } from './tool-scope';

function reviewedMetadata(
  categoryId: string,
  dataProcessing: ExtensionToolMetadata['dataProcessing'],
  offline: ExtensionToolMetadata['offline'],
  capabilities: ExtensionToolMetadata['capabilities'] = [],
): ExtensionToolMetadata {
  return { categoryId, platforms: ['web', 'electron'], dataProcessing, offline, capabilities };
}

export const dataConversionToolCategories: readonly ExtensionToolCategory[] = [{
  id: 'development',
  name: 'Development',
  components: [
    scopeTool(dataConversionExtensionId, 'json-lines', jsonLinesConverter, reviewedMetadata('development', 'memory-only', 'available')),
    scopeTool(dataConversionExtensionId, 'csv-to-json', csvToJson, reviewedMetadata('development', 'memory-only', 'available')),
    scopeTool(dataConversionExtensionId, 'json-to-csv', jsonToCsv, reviewedMetadata('development', 'memory-only', 'available')),
  ],
}];

export const networkSecurityToolCategories: readonly ExtensionToolCategory[] = [{
  id: 'web',
  name: 'Web',
  components: [
    scopeTool(networkSecurityExtensionId, 'http-headers-parser', httpHeadersParser, reviewedMetadata('web', 'memory-only', 'available', ['clipboard.write'])),
    scopeTool(networkSecurityExtensionId, 'cors-analyzer', corsAnalyzer, reviewedMetadata('web', 'memory-only', 'available', ['clipboard.write'])),
    scopeTool(networkSecurityExtensionId, 'csp-analyzer', cspAnalyzer, reviewedMetadata('web', 'memory-only', 'available', ['clipboard.write'])),
  ],
}];

export const offlineReferenceToolCategories: readonly ExtensionToolCategory[] = [{
  id: 'network',
  name: 'Network',
  components: [scopeTool(offlineReferenceExtensionId, 'mac-address-lookup', macAddressLookup, reviewedMetadata('network', 'local-data', 'conditional', ['data.oui']))],
}, {
  id: 'web',
  name: 'Web',
  components: [
    scopeTool(offlineReferenceExtensionId, 'mime-types', mimeTypes, reviewedMetadata('web', 'local-data', 'available')),
    scopeTool(offlineReferenceExtensionId, 'http-status-codes', httpStatusCodes, reviewedMetadata('web', 'local-data', 'available')),
  ],
}];

export const firstPartyExtensionToolCategories: readonly ExtensionToolCategory[] = [
  ...dataConversionToolCategories,
  ...networkSecurityToolCategories,
  ...offlineReferenceToolCategories,
];
