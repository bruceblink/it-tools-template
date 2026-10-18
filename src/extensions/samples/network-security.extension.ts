import type { FirstPartyExtensionModule } from '../extension.types';
import { networkSecurityToolCategories } from './tool-definitions';

const reportableHeaders = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
];

export const extension: FirstPartyExtensionModule = {
  activate() {
    return {
      tools: networkSecurityToolCategories.flatMap(({ components }) => [...components]),
      commands: [{
        id: 'org.it-tools.network-security/summarize-security-headers',
        title: 'Summarize security response headers',
        requiredCapabilities: [],
        execute(input, context) {
          if (typeof input !== 'object' || input === null || Array.isArray(input)) {
            throw new TypeError('Header input must be an object.');
          }
          const names = new Set(Object.keys(input).map(name => name.trim().toLowerCase()));
          const present = reportableHeaders.filter(name => names.has(name));
          const showPresent = context.getSetting('org.it-tools.network-security/show-present-checks');
          if (typeof showPresent !== 'boolean') {
            throw new TypeError('Show present checks must be a boolean.');
          }
          return {
            present: showPresent ? present : [],
            missing: reportableHeaders.filter(name => !names.has(name)),
            coverage: reportableHeaders.length === 0 ? 1 : present.length / reportableHeaders.length,
          };
        },
      }, {
        id: 'org.it-tools.network-security/open-security-headers',
        title: 'Open security headers analyzer',
        requiredCapabilities: [],
        execute: () => undefined,
      }],
      settings: [{
        id: 'org.it-tools.network-security/show-present-checks',
        type: 'boolean',
        defaultValue: true,
        schemaVersion: 1,
        presentation: {
          en: {
            label: 'Show present security checks',
            description: 'Include present checks in the security header summary.',
          },
          zh: {
            label: '显示已配置的安全检查',
            description: '在安全响应头摘要中列出已配置的检查项。',
          },
        },
      }],
      dataProviders: [],
    };
  },
};
