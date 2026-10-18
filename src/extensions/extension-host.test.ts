import { describe, expect, it, vi } from 'vitest';
import { FirstPartyExtensionHost } from './extension-host';
import { validateExtensionManifest } from './extension-manifest';
import type {
  ExtensionContributions,
  ExtensionManifest,
  ExtensionSettingDefinition,
  FirstPartyExtensionPackage,
} from './extension.types';
import { createExtensionSettingStorage } from './extension-storage';
import type { ExtensionSettingStorage, ExtensionStorageAdapter } from './extension-storage';
import { sampleExtensionPackages } from './samples';

const testPluginId = 'com.example.sample';
const testCommandId = `${testPluginId}/run`;

function createManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: testPluginId,
    name: 'Sample extension',
    version: '0.1.0',
    apiVersion: { minInclusive: '0.1.0', maxExclusive: '1.0.0' },
    platforms: ['web', 'electron'],
    entrypoints: { web: './sample.ts', electron: './sample.ts' },
    activationEvents: [`onCommand:${testCommandId}`],
    requestedCapabilities: [],
    contributions: { tools: [], commands: [testCommandId], settings: [], dataProviders: [] },
    ...overrides,
  };
}

function createPackage(
  activate: NonNullable<Awaited<ReturnType<FirstPartyExtensionPackage['load']>>['activate']>,
  manifest = createManifest(),
): FirstPartyExtensionPackage {
  return { manifest, load: async () => ({ activate }) };
}

function createCommandContributions(
  execute: NonNullable<ExtensionContributions['commands'][number]['execute']> = () => 'ok',
): ExtensionContributions {
  return {
    tools: [],
    commands: [{ id: testCommandId, title: 'Run command', requiredCapabilities: [], execute }],
    settings: [],
    dataProviders: [],
  };
}

function createHost(
  grantedCapabilities: Readonly<Record<string, readonly ('clipboard.write' | 'file.read' | 'file.save' | 'device.camera' | 'runtime.info' | 'data.oui')[]>> = {},
  settingsStorage?: ExtensionSettingStorage,
) {
  return new FirstPartyExtensionHost({ apiVersion: '0.1.0', platform: 'web', grantedCapabilities, settingsStorage });
}

describe('first-party extension SDK', () => {
  it('registers three shared-SDK samples without loading implementation modules', async () => {
    const host = createHost();
    for (const extensionPackage of sampleExtensionPackages) {
      host.register(extensionPackage);
      expect(host.getStatus(extensionPackage.manifest.id).state).toBe('registered');
    }
    expect(host.getToolRegistry().tools).toHaveLength(0);
    expect(host.getSearchableCommands().map(command => command.id)).toEqual([
      'org.it-tools.data-conversion/open-json-lines',
      'org.it-tools.network-security/open-security-headers',
      'org.it-tools.offline-reference/open-http-status-codes',
    ]);
    expect(sampleExtensionPackages.every(({ manifest }) => host.getStatus(manifest.id).state === 'registered')).toBe(true);

    const dataPackage = sampleExtensionPackages[0]!;
    const activated = await host.activate(dataPackage.manifest.id, dataPackage.manifest.activationEvents[0]!);
    expect(activated.tools.map(tool => tool.id)).toEqual(dataPackage.manifest.contributions.tools);
    expect(host.getToolRegistry().tools).toHaveLength(3);

    for (const extensionPackage of sampleExtensionPackages.slice(1)) {
      const toolEvent = extensionPackage.manifest.activationEvents.find(event => event.startsWith('onTool:'));
      if (!toolEvent) {
        throw new Error(`Missing tool activation event for ${extensionPackage.manifest.id}.`);
      }
      await host.activate(extensionPackage.manifest.id, toolEvent);
    }
    const registry = host.getToolRegistry();
    expect(registry.tools).toHaveLength(9);
    expect(registry.categories.map(({ id }) => id)).toEqual(['development', 'web', 'network']);
    expect(registry.toolsWithCategory.map(({ path }) => path).sort()).toEqual([
      '/cors-analyzer',
      '/csp-analyzer',
      '/csv-to-json',
      '/http-headers-parser',
      '/http-status-codes',
      '/json-lines-converter',
      '/json-to-csv',
      '/mac-address-lookup',
      '/mime-types',
    ]);
    const settingsCatalog = await host.getSettingsCatalog();
    expect(settingsCatalog.map(({ pluginId }) => pluginId)).toEqual([
      'org.it-tools.data-conversion',
      'org.it-tools.network-security',
    ]);
    expect(settingsCatalog[0]?.settings[0]).toMatchObject({
      definition: { schemaVersion: 2, integer: true },
      migrationStatus: 'default',
    });
    await host.dispose();
  });

  it('runs only a manifest-declared command and validates plugin-scoped tool IDs', async () => {
    const host = createHost();
    const [dataPackage] = sampleExtensionPackages;
    if (!dataPackage) {
      throw new Error('Missing data-conversion sample.');
    }
    host.register(dataPackage);

    await expect(host.activate(dataPackage.manifest.id, 'onCommand:org.it-tools.data-conversion/not-declared'))
      .rejects.toThrow('does not declare activation event');
    expect(host.getStatus(dataPackage.manifest.id).state).toBe('registered');

    const result = await host.executeCommand(
      dataPackage.manifest.id,
      'org.it-tools.data-conversion/summarize-json-lines',
      '{"id":1}\ninvalid\n{"id":2}',
    );
    expect(result).toEqual({ totalRecords: 3, validRecords: 2, invalidRecords: 1 });
    expect(host.getToolRegistry().tools.map(tool => tool.path)).toEqual([
      '/json-lines-converter',
      '/csv-to-json',
      '/json-to-csv',
    ]);
    await host.dispose();
  });

  it('activates the network-security sample and returns a header-only report', async () => {
    const host = createHost();
    const networkPackage = sampleExtensionPackages.find(candidate => candidate.manifest.id === 'org.it-tools.network-security');
    if (!networkPackage) {
      throw new Error('Missing network-security sample.');
    }
    host.register(networkPackage);

    const result = await host.executeCommand(
      networkPackage.manifest.id,
      'org.it-tools.network-security/summarize-security-headers',
      {
        'Content-Security-Policy': 'default-src \'self\'',
        'Strict-Transport-Security': 'max-age=31536000',
      },
    );
    expect(result).toEqual({
      present: ['content-security-policy', 'strict-transport-security'],
      missing: ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'],
      coverage: 2 / 6,
    });
    await host.setSetting(networkPackage.manifest.id, 'org.it-tools.network-security/show-present-checks', false);
    await expect(host.executeCommand(
      networkPackage.manifest.id,
      'org.it-tools.network-security/summarize-security-headers',
      { 'Content-Security-Policy': 'default-src \'self\'' },
    )).resolves.toMatchObject({ present: [], coverage: 1 / 6 });
    expect(host.getToolRegistry().tools).toHaveLength(3);
    await host.dispose();
  }, 30_000);

  it('applies the stored record limit to its package command', async () => {
    const host = createHost();
    const [dataPackage] = sampleExtensionPackages;
    if (!dataPackage) {
      throw new Error('Missing data-conversion sample.');
    }
    host.register(dataPackage);
    await host.setSetting(dataPackage.manifest.id, 'org.it-tools.data-conversion/max-records', 2);

    await expect(host.executeCommand(
      dataPackage.manifest.id,
      'org.it-tools.data-conversion/summarize-json-lines',
      '{"id":1}\n{"id":2}\n{"id":3}',
    )).resolves.toEqual({ totalRecords: 2, validRecords: 2, invalidRecords: 0, skippedRecords: 1 });
    await host.dispose();
  });

  it('blocks commands from reading settings outside their package declaration', async () => {
    const extensionPackage = createPackage(() => createCommandContributions((_input, context) =>
      context.getSetting(`${testPluginId}/undeclared`),
    ));
    const host = createHost();
    host.register(extensionPackage);

    await expect(host.executeCommand(testPluginId, testCommandId, null))
      .rejects.toThrow('cannot read undeclared setting');
    await host.dispose();
  });

  it('keeps typed setting values in the plugin namespace across deactivation', async () => {
    const host = createHost();
    const [dataPackage] = sampleExtensionPackages;
    if (!dataPackage) {
      throw new Error('Missing data-conversion sample.');
    }
    host.register(dataPackage);
    const settingId = 'org.it-tools.data-conversion/max-records';

    expect(await host.getSetting(dataPackage.manifest.id, settingId)).toBe(10_000);
    await host.setSetting(dataPackage.manifest.id, settingId, 250);
    await expect(host.setSetting(dataPackage.manifest.id, settingId, 0)).rejects.toThrow('outside its allowed range');
    await host.deactivate(dataPackage.manifest.id);
    expect(await host.getSetting(dataPackage.manifest.id, settingId)).toBe(250);
    await host.dispose();
  });

  it('persists preferences under an extension-scoped storage key across host instances', async () => {
    const values = new Map<string, string>();
    const storageAdapter: ExtensionStorageAdapter = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };
    const [dataPackage] = sampleExtensionPackages;
    if (!dataPackage) {
      throw new Error('Missing data-conversion sample.');
    }
    const settingId = 'org.it-tools.data-conversion/max-records';
    const firstHost = createHost({}, createExtensionSettingStorage(storageAdapter));
    firstHost.register(dataPackage);
    await firstHost.setSetting(dataPackage.manifest.id, settingId, 325);
    const storedKeys = [...values.keys()];
    expect(storedKeys).toHaveLength(1);
    expect(storedKeys[0]).toContain('org.it-tools.data-conversion');
    await firstHost.dispose();

    const secondHost = createHost({}, createExtensionSettingStorage(storageAdapter));
    secondHost.register(dataPackage);
    await expect(secondHost.getSetting(dataPackage.manifest.id, settingId)).resolves.toBe(325);
    await secondHost.dispose();
  });

  it('migrates legacy setting values and preserves the original value when migration fails', async () => {
    const settingId = `${testPluginId}/record-limit`;
    const legacyKey = `it-tools.extension-setting.v1:${encodeURIComponent(testPluginId)}:${encodeURIComponent(settingId)}`;
    const values = new Map<string, string>([[legacyKey, JSON.stringify(24.8)]]);
    const storageAdapter: ExtensionStorageAdapter = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };
    const setting: ExtensionSettingDefinition = {
      id: settingId,
      type: 'number',
      defaultValue: 10,
      schemaVersion: 2,
      integer: true,
      minimum: 1,
      maximum: 100,
      migrations: [{ fromVersion: 1, migrate: value => Math.floor(value as number) }],
    };
    const manifest = createManifest({
      activationEvents: [`onCommand:${testCommandId}`, `onSetting:${settingId}`],
      contributions: { tools: [], commands: [testCommandId], settings: [settingId], dataProviders: [] },
    });
    const extensionPackage = createPackage(() => ({
      ...createCommandContributions(),
      settings: [setting],
    }), manifest);
    const host = createHost({}, createExtensionSettingStorage(storageAdapter));
    host.register(extensionPackage);

    await expect(host.getSettingState(testPluginId, settingId)).resolves.toMatchObject({
      value: 24,
      migrationStatus: 'migrated',
      definition: { schemaVersion: 2, integer: true },
    });
    expect(JSON.parse(values.get(legacyKey)!)).toEqual({ schemaVersion: 2, value: 24 });
    await host.dispose();

    const failedValues = new Map<string, string>([[legacyKey, JSON.stringify(24.8)]]);
    const failedStorageAdapter: ExtensionStorageAdapter = {
      getItem: key => failedValues.get(key) ?? null,
      setItem: (key, value) => { failedValues.set(key, value); },
    };
    const failingSetting: ExtensionSettingDefinition = {
      ...setting,
      migrations: [{ fromVersion: 1, migrate: () => { throw new Error('conversion failed'); } }],
    };
    const failingPackage = createPackage(() => ({
      ...createCommandContributions(),
      settings: [failingSetting],
    }), manifest);
    const failedHost = createHost({}, createExtensionSettingStorage(failedStorageAdapter));
    failedHost.register(failingPackage);

    await expect(failedHost.getSettingState(testPluginId, settingId)).resolves.toMatchObject({
      value: 10,
      migrationStatus: 'migration-failed',
    });
    expect(failedValues.get(legacyKey)).toBe(JSON.stringify(24.8));
    await failedHost.dispose();
  });

  it('returns local data with provider and schema versions, bounded by the manifest limit', async () => {
    const host = createHost();
    const offlinePackage = sampleExtensionPackages.find(candidate => candidate.manifest.id === 'org.it-tools.offline-reference');
    if (!offlinePackage) {
      throw new Error('Missing offline-reference sample.');
    }
    host.register(offlinePackage);

    const snapshot = await host.readData(offlinePackage.manifest.id, 'org.it-tools.offline-reference/http-status-catalog');
    expect(snapshot).toMatchObject({
      pluginId: offlinePackage.manifest.id,
      version: '1.0.0',
      schemaVersion: 1,
    });
    expect(Array.isArray(snapshot.value)).toBe(true);
    await host.dispose();
  }, 15_000);

  it('reads OUI vendor data through the versioned shard provider without disabling other tools', async () => {
    const offlinePackage = sampleExtensionPackages.find(candidate => candidate.manifest.id === 'org.it-tools.offline-reference');
    if (!offlinePackage) {
      throw new Error('Missing offline-reference sample.');
    }
    const shard = {
      prefix: '2',
      file: 'oui-2-0123456789abcdef.json',
      sha256: '0123456789abcdef'.repeat(4),
      recordCount: 1,
      rawBytes: 24,
      gzipBytes: 20,
    };
    const ouiManifest = { schemaVersion: 1, dataVersion: '1.2.0', recordCount: 1, shards: [shard] };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => new Response(
      JSON.stringify(String(url).endsWith('manifest.json') ? ouiManifest : { '203706': 'Example vendor' }),
      { headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const host = createHost();
      host.register(offlinePackage);

      const snapshot = await host.readData(
        offlinePackage.manifest.id,
        'org.it-tools.offline-reference/oui-vendor',
        '20:37:06:12:34:56',
      );
      expect(snapshot).toMatchObject({ version: '1.2.0', schemaVersion: 1, value: { vendor: 'Example vendor' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(host.getStatus(offlinePackage.manifest.id).state).toBe('active');
      await host.dispose();
    }
    finally {
      vi.unstubAllGlobals();
    }
  }, 20_000);

  it('checks host API bounds, platform support, and safe entrypoints before registration', () => {
    const manifest = createManifest();
    expect(() => validateExtensionManifest(manifest, '1.0.0', 'web')).toThrow('does not support host API');
    expect(() => validateExtensionManifest(manifest, '0.1.0', 'ios' as never)).toThrow('does not support platform ios');
    expect(() => validateExtensionManifest(createManifest({
      entrypoints: { web: './../outside.ts', electron: './sample.ts' },
    }), '0.1.0', 'web')).toThrow('safe relative web entrypoint');
    expect(() => validateExtensionManifest(createManifest({
      apiVersion: { minInclusive: '1.0.0', maxExclusive: '0.1.0' },
    }), '0.1.0', 'web')).toThrow('empty API compatibility range');
  });

  it('rejects duplicate package registration and unsupported host APIs', () => {
    const host = createHost();
    const extensionPackage = createPackage(() => createCommandContributions());
    host.register(extensionPackage);
    expect(() => host.register(extensionPackage)).toThrow('already registered');
    expect(() => new FirstPartyExtensionHost({ apiVersion: '0.1.0-beta', platform: 'web' }))
      .toThrow('stable semantic version format');
  });

  it('grants only requested capabilities and blocks commands until the user grants them', async () => {
    const capabilityId = 'clipboard.write' as const;
    const manifest = createManifest({ requestedCapabilities: [capabilityId] });
    const execute = vi.fn((_input: unknown, context: Parameters<ExtensionContributions['commands'][number]['execute']>[1]) => context.hasCapability(capabilityId));
    const extensionPackage = createPackage(() => ({
      ...createCommandContributions(execute),
      commands: [{ id: testCommandId, title: 'Run command', requiredCapabilities: [capabilityId], execute }],
    }), manifest);
    const deniedHost = createHost();
    deniedHost.register(extensionPackage);
    await expect(deniedHost.executeCommand(testPluginId, testCommandId, null)).rejects.toThrow('missing a granted capability');
    expect(execute).not.toHaveBeenCalled();
    await deniedHost.dispose();

    const allowedHost = createHost({ [testPluginId]: [capabilityId, 'runtime.info'] });
    allowedHost.register(extensionPackage);
    await expect(allowedHost.executeCommand(testPluginId, testCommandId, null)).resolves.toBe(true);
    await allowedHost.dispose();
  });

  it('cleans activation resources in reverse order and isolates a failed package', async () => {
    const cleanupOrder: string[] = [];
    const badPackage = createPackage((context) => {
      context.registerDisposable(() => { cleanupOrder.push('first'); });
      context.registerDisposable(() => { cleanupOrder.push('second'); });
      throw new Error('activation failed');
    });
    const goodPluginId = 'com.example.good';
    const goodCommandId = `${goodPluginId}/run`;
    const goodPackage = createPackage(
      () => ({
        tools: [],
        commands: [{ id: goodCommandId, title: 'Run', requiredCapabilities: [], execute: () => 'healthy' }],
        settings: [],
        dataProviders: [],
      }),
      createManifest({
        id: goodPluginId,
        contributions: { tools: [], commands: [goodCommandId], settings: [], dataProviders: [] },
        activationEvents: [`onCommand:${goodCommandId}`],
      }),
    );
    const host = createHost();
    host.register(badPackage);
    host.register(goodPackage);

    await expect(host.activate(testPluginId, `onCommand:${testCommandId}`)).rejects.toThrow('activation failed');
    expect(cleanupOrder).toEqual(['second', 'first']);
    expect(host.getStatus(testPluginId)).toMatchObject({ state: 'failed', failure: 'activation' });
    await expect(host.executeCommand(goodPluginId, goodCommandId, null)).resolves.toBe('healthy');
    expect(host.getStatus(goodPluginId).state).toBe('active');
    await host.dispose();
  });

  it('loads concurrent activation once and disposes each activation once', async () => {
    let loadCount = 0;
    let activationCount = 0;
    let disposalCount = 0;
    const extensionPackage = createPackage(async (context) => {
      activationCount++;
      context.registerDisposable(() => { disposalCount++; });
      return createCommandContributions();
    });
    const originalLoader = extensionPackage.load;
    extensionPackage.load = async () => {
      loadCount++;
      await new Promise(resolve => setTimeout(resolve, 1));
      return originalLoader();
    };
    const host = createHost();
    host.register(extensionPackage);

    const [first, second] = await Promise.all([
      host.activate(testPluginId, `onCommand:${testCommandId}`),
      host.activate(testPluginId, `onCommand:${testCommandId}`),
    ]);
    expect(first).toBe(second);
    expect({ loadCount, activationCount }).toEqual({ loadCount: 1, activationCount: 1 });
    await host.deactivate(testPluginId);
    await host.deactivate(testPluginId);
    expect(disposalCount).toBe(1);
    await host.dispose();
  });

  it('keeps disabled packages inactive until an explicit enable action', async () => {
    const host = createHost();
    host.register(createPackage(() => createCommandContributions()));
    await host.disable(testPluginId);
    expect(host.getStatus(testPluginId).state).toBe('disabled');
    await expect(host.executeCommand(testPluginId, testCommandId, null)).rejects.toThrow('is disabled');

    host.enable(testPluginId);
    await expect(host.executeCommand(testPluginId, testCommandId, null)).resolves.toBe('ok');
    await host.dispose();
  });

  it('marks command errors as failed and still disposes every registered resource', async () => {
    const cleanup = vi.fn();
    const extensionPackage = createPackage((context) => {
      context.registerDisposable(cleanup);
      return createCommandContributions(() => { throw new Error('command failed'); });
    });
    const host = createHost();
    host.register(extensionPackage);

    await expect(host.executeCommand(testPluginId, testCommandId, null)).rejects.toThrow('command failed');
    expect(host.getStatus(testPluginId)).toMatchObject({ state: 'failed', failure: 'command' });
    expect(cleanup).toHaveBeenCalledTimes(1);
    await host.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized data while keeping the provider available for retry', async () => {
    const providerId = `${testPluginId}/tiny-catalog`;
    let loadCount = 0;
    const manifest = createManifest({
      activationEvents: [`onData:${providerId}`],
      contributions: { tools: [], commands: [], settings: [], dataProviders: [providerId] },
    });
    const extensionPackage = createPackage(() => ({
      tools: [],
      commands: [],
      settings: [],
      dataProviders: [{
        id: providerId,
        version: '1.0.0',
        schemaVersion: 1,
        maxBytes: 4,
        load: () => (++loadCount === 1 ? { long: 'data' } : true),
      }],
    }), manifest);
    const host = createHost();
    host.register(extensionPackage);

    await expect(host.readData(testPluginId, providerId)).rejects.toThrow('oversized data');
    expect(host.getStatus(testPluginId).state).toBe('active');
    await expect(host.readData(testPluginId, providerId)).resolves.toMatchObject({ value: true });
    expect(loadCount).toBe(2);
    await host.dispose();
  });
});
