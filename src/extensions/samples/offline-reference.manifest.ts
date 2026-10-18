import type { ExtensionManifest } from '../extension.types';
import { offlineReferenceExtensionId } from './sample-ids';

export const offlineReferenceManifest = {
  id: offlineReferenceExtensionId,
  name: 'Offline reference sample',
  version: '0.1.0',
  apiVersion: { minInclusive: '0.1.0', maxExclusive: '1.0.0' },
  platforms: ['web', 'electron'],
  entrypoints: { web: './offline-reference.extension.ts', electron: './offline-reference.extension.ts' },
  activationEvents: [
    'onTool:org.it-tools.offline-reference/mac-address-lookup',
    'onTool:org.it-tools.offline-reference/mime-types',
    'onTool:org.it-tools.offline-reference/http-status-codes',
    'onData:org.it-tools.offline-reference/http-status-catalog',
    'onData:org.it-tools.offline-reference/oui-vendor',
    'onCommand:org.it-tools.offline-reference/open-http-status-codes',
  ],
  requestedCapabilities: ['data.oui'],
  contributions: {
    tools: [
      'org.it-tools.offline-reference/mac-address-lookup',
      'org.it-tools.offline-reference/mime-types',
      'org.it-tools.offline-reference/http-status-codes',
    ],
    commands: ['org.it-tools.offline-reference/open-http-status-codes'],
    settings: [],
    dataProviders: [
      'org.it-tools.offline-reference/http-status-catalog',
      'org.it-tools.offline-reference/oui-vendor',
    ],
  },
  searchCommands: [{
    id: 'org.it-tools.offline-reference/open-http-status-codes',
    translations: {
      en: {
        title: 'Open HTTP status codes reference',
        description: 'Open the local HTTP status code reference.',
      },
      zh: {
        title: '打开 HTTP 状态码参考',
        description: '打开本地 HTTP 状态码资料。',
      },
    },
    keywords: ['http', 'status', 'codes', 'reference', 'protocol'],
    targetPath: '/http-status-codes',
  }],
} satisfies ExtensionManifest;
