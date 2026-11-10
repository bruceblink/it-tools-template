import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExtensionPluginManager from './ExtensionPluginManager.vue';

const v2Package: DesktopPluginV2Snapshot = {
  pluginId: 'org.example.demo',
  name: 'Demo plugin',
  version: '1.0.0',
  runtime: 'process',
  manifest: {
    formatVersion: 2,
    id: 'org.example.demo',
    name: 'Demo plugin',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: [],
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
        capabilities: [],
        inputs: [],
        output: { kind: 'text' },
      }],
      commands: [],
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

const desktopBridge = {
  listPlugins: vi.fn(async (): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot[]>> => ({ ok: true, value: [] })),
  installPluginPackage: vi.fn(),
  activatePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  listTrustedPluginSigners: vi.fn(async (): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot[]>> => ({ ok: true, value: [] })),
  previewPluginSigner: vi.fn(),
  trustPluginSigner: vi.fn(),
  revokePluginSigner: vi.fn(),
  listPluginV2Packages: v2List,
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
      expect(wrapper.text()).toContain('Host-rendered plugin packages (v2)');
      expect(wrapper.text()).toContain('Command execution is still under development.');
      expect(wrapper.text()).toContain('Demo plugin');
      expect(wrapper.text()).toContain('Return the submitted value.');

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
});
