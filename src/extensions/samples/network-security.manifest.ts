import type { ExtensionManifest } from '../extension.types';
import { networkSecurityExtensionId } from './sample-ids';

export const networkSecurityManifest = {
  id: networkSecurityExtensionId,
  name: 'Network and security sample',
  version: '0.1.0',
  apiVersion: { minInclusive: '0.1.0', maxExclusive: '1.0.0' },
  platforms: ['web', 'electron'],
  entrypoints: { web: './network-security.extension.ts', electron: './network-security.extension.ts' },
  activationEvents: [
    'onTool:org.it-tools.network-security/http-headers-parser',
    'onTool:org.it-tools.network-security/cors-analyzer',
    'onTool:org.it-tools.network-security/csp-analyzer',
    'onCommand:org.it-tools.network-security/summarize-security-headers',
    'onCommand:org.it-tools.network-security/open-security-headers',
    'onSetting:org.it-tools.network-security/show-present-checks',
  ],
  requestedCapabilities: ['clipboard.write'],
  contributions: {
    tools: [
      'org.it-tools.network-security/http-headers-parser',
      'org.it-tools.network-security/cors-analyzer',
      'org.it-tools.network-security/csp-analyzer',
    ],
    commands: [
      'org.it-tools.network-security/summarize-security-headers',
      'org.it-tools.network-security/open-security-headers',
    ],
    settings: ['org.it-tools.network-security/show-present-checks'],
    dataProviders: [],
  },
  searchCommands: [{
    id: 'org.it-tools.network-security/open-security-headers',
    translations: {
      en: {
        title: 'Open security headers analyzer',
        description: 'Open the response security headers analyzer.',
      },
      zh: {
        title: '打开安全响应头分析器',
        description: '打开 HTTP 响应安全头分析工具。',
      },
    },
    keywords: ['security', 'headers', 'csp', 'http', 'response'],
    targetPath: '/security-headers-analyzer',
  }],
} satisfies ExtensionManifest;
