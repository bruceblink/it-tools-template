import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdateNotice from './UpdateNotice.vue';
import type { DesktopUpdateBridge, DesktopUpdateState } from '@/shared/desktop-services/updates';

const Button = defineComponent({
  emits: ['click'],
  setup(_props, { slots, emit }) {
    return () => h('button', { onClick: () => emit('click') }, slots.default?.());
  },
});
const initial: DesktopUpdateState = {
  currentVersion: '1.0.0', autoCheck: true, status: 'available', availableVersion: '1.1.0',
};

describe('global desktop update notice', () => {
  afterEach(() => { delete window.itToolsDesktop; });

  it('shows updates outside settings and exposes download, cancellation and install actions', async () => {
    let publish: ((state: DesktopUpdateState) => void) | undefined;
    const bridge: DesktopUpdateBridge = {
      getState: vi.fn(async () => initial),
      onState: vi.fn((callback) => { publish = callback; return () => {}; }),
      setAutoCheck: vi.fn(async () => initial),
      check: vi.fn(async () => initial),
      download: vi.fn(async () => initial),
      cancel: vi.fn(async () => initial),
      install: vi.fn(async () => initial),
    };
    window.itToolsDesktop = { getRuntimeInfo: async () => ({ platform: 'win32', version: '1.0.0' }), updates: bridge };
    const wrapper = mount(UpdateNotice, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })],
        stubs: { NButton: Button },
        mocks: { $router: { push: vi.fn() } },
      },
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Version 1.1.0 is available.'));
    await wrapper.findAll('button').find(button => button.text() === 'Download update')!.trigger('click');
    expect(bridge.download).toHaveBeenCalledOnce();
    publish!({ ...initial, status: 'downloading', progress: { percent: 42, transferred: 42, total: 100, bytesPerSecond: 1 } });
    await nextTick();
    expect(wrapper.text()).toContain('42%');
    await wrapper.findAll('button').find(button => button.text() === 'Cancel download')!.trigger('click');
    expect(bridge.cancel).toHaveBeenCalledOnce();
    publish!({ ...initial, status: 'downloaded' });
    await nextTick();
    await wrapper.findAll('button').find(button => button.text() === 'Quit and install')!.trigger('click');
    expect(bridge.install).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
