import { isElectronRuntime } from '@/platform-adapter';
import { extensionSdkApiVersion } from './index';
import { FirstPartyExtensionHost } from './extension-host';
import { createBrowserExtensionSettingStorage } from './extension-storage';
import { sampleExtensionPackages } from './samples';

const extensionHost = new FirstPartyExtensionHost({
  apiVersion: extensionSdkApiVersion,
  platform: isElectronRuntime() ? 'electron' : 'web',
  settingsStorage: createBrowserExtensionSettingStorage(),
});

for (const extensionPackage of sampleExtensionPackages) {
  extensionHost.register(extensionPackage);
}

export { extensionHost };
