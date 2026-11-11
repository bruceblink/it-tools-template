import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExtensionPluginManager from './ExtensionPluginManager.vue';

const v2Package: DesktopPluginV2Snapshot = {
  pluginId: 'org.example.demo',
  name: 'Demo plugin',
  version: '1.0.0',
  runtime: 'process',
  runtimeStatus: 'ready',
  manifest: {
    formatVersion: 2,
    id: 'org.example.demo',
    name: 'Demo plugin',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: ['runtime.info', 'settings.read'],
    activationEvents: [],
    contributions: {
      tools: [{
        id: 'org.example.demo/echo',
        title: 'Echo',
        description: 'Return the submitted value.',
        keywords: ['echo'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: ['runtime.info', 'settings.read'],
        settings: ['org.example.demo/endpoint'],
        inputs: [],
        output: { kind: 'text' },
      }],
      commands: [],
      settings: [{
        id: 'org.example.demo/endpoint',
        label: 'Endpoint',
        description: 'Service endpoint.',
        type: 'string',
        defaultValue: 'https://default.example',
        maxLength: 256,
      }],
    },
  },
  status: 'installed',
};

const v2List = vi.fn(async (): Promise<DesktopPluginOperationResult<DesktopPluginV2Snapshot[]>> => ({
  ok: true,
  value: [v2Package],
}));
const v2Install = vi.fn(async (): Promise<DesktopPluginOperationResult<DesktopPluginV2Snapshot | null>> => ({
  ok: true,
  value: v2Package,
}));
const v2Uninstall = vi.fn(async (): Promise<DesktopPluginOperationResult<boolean>> => ({
  ok: true,
  value: true,
}));
const v2SettingsList = vi.fn(async (): Promise<DesktopPluginOperationResult<DesktopPluginV2SettingsSnapshot>> => ({
  ok: true,
  value: {
    pluginId: v2Package.pluginId,
    version: v2Package.version,
    settings: [{
      ...v2Package.manifest.contributions.settings![0]!,
      value: 'https://stored.example',
    }],
  },
}));
const v2SettingUpdate = vi.fn(async (input: DesktopPluginV2SettingUpdateRequest): Promise<DesktopPluginOperationResult<DesktopPluginV2SettingsSnapshot>> => ({
  ok: true,
  value: {
    pluginId: input.pluginId,
    version: input.version,
    settings: [{
      ...v2Package.manifest.contributions.settings![0]!,
      value: input.value,
    }],
  },
}));

const desktopBridge = {
  listTrustedPluginSigners: vi.fn(async (): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot[]>> => ({ ok: true, value: [] })),
  previewPluginSigner: vi.fn(),
  trustPluginSigner: vi.fn(),
  revokePluginSigner: vi.fn(),
  listPluginV2Packages: v2List,
  listPluginV2Settings: v2SettingsList,
  updatePluginV2Setting: v2SettingUpdate,
  installPluginV2Package: v2Install,
  uninstallPluginV2Package: v2Uninstall,
} as unknown as NonNullable<Window['itToolsDesktop']>;

let previousBridge: Window['itToolsDesktop'];

function setDesktopBridge(bridge?: Window['itToolsDesktop']): void {
  previousBridge = window.itToolsDesktop;
  Object.defineProperty(window, 'itToolsDesktop', { configurable: true, writable: true, value: bridge });
}

afterEach(() => {
  Object.defineProperty(window, 'itToolsDesktop', { configurable: true, writable: true, value: previousBridge });
  v2List.mockClear();
  v2Install.mockClear();
  v2Uninstall.mockClear();
  v2SettingsList.mockClear();
  v2SettingUpdate.mockClear();
});

describe('desktop plugin wording', () => {
  it.each([
    ['en', 'Desktop plugin packages', 'available only in the desktop app'],
    ['zh', '桌面插件包', '外部插件包只支持桌面应用'],
  ])('uses product terminology in %s', async (locale, heading, availability) => {
    const wrapper = mount(ExtensionPluginManager, {
      global: {
        plugins: [createI18n({ legacy: false, locale, messages: { [locale]: {} } })],
        stubs: ['router-link'],
      },
    });
    try {
      await flushPromises();
      expect(wrapper.get('h2').text()).toBe(heading);
      expect(wrapper.text()).toContain(availability);
      expect(wrapper.text()).not.toMatch(/electron/i);
    }
    finally {
      wrapper.unmount();
    }
  });

  it('lists and installs host-rendered v2 packages in the existing manager', async () => {
    setDesktopBridge(desktopBridge);
    const wrapper = mount(ExtensionPluginManager, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })],
        stubs: ['router-link'],
      },
    });
    try {
      await flushPromises();
      expect(wrapper.text()).toContain('Host-rendered plugin packages');
      expect(wrapper.text()).toContain('WASM tools can request runtime information, declared settings, or host OUI data with your approval for each run.');
      expect(wrapper.text()).toContain('Demo plugin');
      expect(wrapper.text()).toContain('Return the submitted value.');
      expect(wrapper.text()).toContain('runtime.info');
      expect(wrapper.text()).toContain('approval required for each command');
      expect(wrapper.text()).toContain('Declared settings · approval required for each command');
      expect(wrapper.text()).toContain('Host settings');
      expect((wrapper.find('.plugin-setting-control input').element as HTMLInputElement).value).toBe('https://stored.example');

      const installButton = wrapper.findAll('button').find(button => button.text().includes('Install v2 package'));
      expect(installButton).toBeDefined();
      await installButton!.trigger('click');
      await flushPromises();

      expect(v2Install).toHaveBeenCalledOnce();
      expect(v2List).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain('Signed v2 package installed.');

      const uninstallButton = wrapper.findAll('button').find(button => button.text().includes('Uninstall package'));
      expect(uninstallButton).toBeDefined();
      await uninstallButton!.trigger('click');
      await flushPromises();
      expect(v2Uninstall).toHaveBeenCalledWith(v2Package.pluginId, v2Package.version);
      expect(wrapper.text()).toContain('V2 package removed.');
    }
    finally {
      wrapper.unmount();
    }
  });

  it('edits v2 settings through the host bridge', async () => {
    setDesktopBridge(desktopBridge);
    const wrapper = mount(ExtensionPluginManager, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })],
        stubs: ['router-link'],
      },
    });
    try {
      await flushPromises();
      const endpoint = wrapper.get('.plugin-setting-control input');
      await endpoint.setValue('https://updated.example');
      const saveButton = wrapper.findAll('button').find(button => button.text().includes('Save setting'));
      expect(saveButton).toBeDefined();
      await saveButton!.trigger('click');
      await flushPromises();

      expect(v2SettingUpdate).toHaveBeenCalledWith({
        pluginId: v2Package.pluginId,
        version: v2Package.version,
        settingId: 'org.example.demo/endpoint',
        value: 'https://updated.example',
      });
      expect(wrapper.text()).toContain('Plugin setting saved.');
    }
    finally {
      wrapper.unmount();
    }
  });

  it('shows an explicit v2 install state while the native picker is still open', async () => {
    setDesktopBridge(desktopBridge);
    const wrapper = mount(ExtensionPluginManager, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })],
        stubs: ['router-link'],
      },
    });
    try {
      await flushPromises();
      v2Install.mockImplementationOnce(() => new Promise(() => undefined));
      const installButton = wrapper.findAll('button').find(button => button.text().includes('Install v2 package'));
      expect(installButton).toBeDefined();
      await installButton!.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Installing v2 package…');
      expect(installButton!.classes()).toContain('n-button--loading');
    }
    finally {
      wrapper.unmount();
    }
  });
});
