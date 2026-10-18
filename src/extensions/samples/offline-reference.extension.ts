import { codesByCategories } from '@/tools/http-status-codes/http-status-codes.constants';
import { createOuiVendorLookup } from '@/tools/mac-address-lookup/mac-address-lookup.service';
import type { FirstPartyExtensionModule } from '../extension.types';
import { offlineReferenceToolCategories } from './tool-definitions';

export const extension: FirstPartyExtensionModule = {
  activate() {
    const ouiLookup = createOuiVendorLookup();
    return {
      tools: offlineReferenceToolCategories.flatMap(({ components }) => [...components]),
      commands: [{
        id: 'org.it-tools.offline-reference/open-http-status-codes',
        title: 'Open HTTP status codes reference',
        requiredCapabilities: [],
        execute: () => undefined,
      }],
      settings: [],
      dataProviders: [{
        id: 'org.it-tools.offline-reference/http-status-catalog',
        version: '1.0.0',
        schemaVersion: 1,
        maxBytes: 256 * 1024,
        load: () => codesByCategories,
      }, {
        id: 'org.it-tools.offline-reference/oui-vendor',
        version: '1.2.0',
        schemaVersion: 1,
        maxBytes: 512,
        load: async (signal, query) => {
          if (typeof query !== 'string') {
            return { vendor: null };
          }
          const vendor = await ouiLookup.findVendor(query, signal);
          return { vendor: vendor ?? null };
        },
      }],
    };
  },
};
