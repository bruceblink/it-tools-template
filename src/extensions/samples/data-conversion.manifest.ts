import type { ExtensionManifest } from '../extension.types';
import { dataConversionExtensionId } from './sample-ids';

export const dataConversionManifest = {
  id: dataConversionExtensionId,
  name: 'Data conversion sample',
  version: '0.1.0',
  apiVersion: { minInclusive: '0.1.0', maxExclusive: '1.0.0' },
  platforms: ['web', 'electron'],
  entrypoints: { web: './data-conversion.extension.ts', electron: './data-conversion.extension.ts' },
  activationEvents: [
    'onTool:org.it-tools.data-conversion/json-lines',
    'onTool:org.it-tools.data-conversion/csv-to-json',
    'onTool:org.it-tools.data-conversion/json-to-csv',
    'onCommand:org.it-tools.data-conversion/summarize-json-lines',
    'onCommand:org.it-tools.data-conversion/open-json-lines',
    'onSetting:org.it-tools.data-conversion/max-records',
  ],
  requestedCapabilities: [],
  contributions: {
    tools: [
      'org.it-tools.data-conversion/json-lines',
      'org.it-tools.data-conversion/csv-to-json',
      'org.it-tools.data-conversion/json-to-csv',
    ],
    commands: [
      'org.it-tools.data-conversion/summarize-json-lines',
      'org.it-tools.data-conversion/open-json-lines',
    ],
    settings: ['org.it-tools.data-conversion/max-records'],
    dataProviders: [],
  },
  searchCommands: [{
    id: 'org.it-tools.data-conversion/open-json-lines',
    translations: {
      en: {
        title: 'Open JSON Lines converter',
        description: 'Open the JSON Lines converter from the data conversion package.',
      },
      zh: {
        title: '打开 JSON Lines 转换器',
        description: '打开数据转换工具包中的 JSON Lines 转换器。',
      },
    },
    keywords: ['jsonl', 'ndjson', 'json lines', 'convert'],
    targetPath: '/json-lines-converter',
  }],
} satisfies ExtensionManifest;
