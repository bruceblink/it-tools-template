import type { FirstPartyExtensionPackage } from '../extension.types';
import { dataConversionManifest } from './data-conversion.manifest';
import { networkSecurityManifest } from './network-security.manifest';
import { offlineReferenceManifest } from './offline-reference.manifest';
import {
  dataConversionToolCategories,
  networkSecurityToolCategories,
  offlineReferenceToolCategories,
} from './tool-definitions';

/** Keep module implementations out of the dependency graph until their first declared event. */
export const sampleExtensionPackages: readonly FirstPartyExtensionPackage[] = [
  {
    manifest: dataConversionManifest,
    toolCategories: dataConversionToolCategories,
    load: async () => (await import('./data-conversion.extension')).extension,
  },
  {
    manifest: networkSecurityManifest,
    toolCategories: networkSecurityToolCategories,
    load: async () => (await import('./network-security.extension')).extension,
  },
  {
    manifest: offlineReferenceManifest,
    toolCategories: offlineReferenceToolCategories,
    load: async () => (await import('./offline-reference.extension')).extension,
  },
];
