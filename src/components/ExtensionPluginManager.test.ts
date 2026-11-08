import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import ExtensionPluginManager from './ExtensionPluginManager.vue';

describe('desktop plugin wording', () => {
  it.each([
    ['en', 'Desktop plugin packages', 'available only in the desktop app'],
    ['zh', '桌面插件包', '外部插件包只支持桌面应用'],
  ])('uses product terminology in %s', async (locale, heading, availability) => {
    const wrapper = mount(ExtensionPluginManager, {
      global: {
        plugins: [createI18n({ legacy: false, locale, messages: { [locale]: {} } })],
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
});
