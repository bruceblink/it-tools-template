import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import PluginToolWorkbench from './PluginToolWorkbench.page.vue';
import type { PluginToolWorkbenchDefinition } from '@/shared/plugin-tool-workbench';

const tool: PluginToolWorkbenchDefinition = {
  pluginId: 'org.example.plugin',
  version: '1.0.0',
  toolId: 'org.example.plugin/example',
  title: 'Example tool',
  description: 'Run an example command.',
  commandId: 'org.example.plugin/run',
  fields: [
    { id: 'name', type: 'text', label: 'Name', required: true },
    { id: 'details', type: 'textarea', label: 'Details' },
  ],
  resultKind: 'json',
};

describe('PluginToolWorkbench', () => {
  it('renders host controls and sends a bounded command request', async () => {
    const execute = vi.fn(async (request) => ({
      kind: 'json' as const,
      value: { commandId: request.commandId, name: request.input.name },
    }));
    const wrapper = mount(PluginToolWorkbench, {
      props: { tool, execute },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
    });

    await wrapper.get('input').setValue('Ada');
    await wrapper.get('textarea').setValue('Details');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      pluginId: tool.pluginId,
      version: tool.version,
      toolId: tool.toolId,
      commandId: tool.commandId,
      input: { name: 'Ada', details: 'Details' },
    });
    expect(wrapper.text()).toContain('"name": "Ada"');
  });

  it('does not execute a command when a required field is empty', async () => {
    const execute = vi.fn();
    const wrapper = mount(PluginToolWorkbench, {
      props: { tool, execute },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
    });

    await wrapper.get('form').trigger('submit');

    expect(execute).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain('Name is required.');
  });

  // 超时和取消显示固定提示；其他异常仍显示通用提示，不暴露异常详情。
  it.each([
    { locale: 'en', code: 'timeout', message: 'The plugin command timed out.' },
    { locale: 'zh', code: 'timeout', message: '插件命令执行超时。' },
    { locale: 'en', code: 'cancelled', message: 'The plugin command was cancelled.' },
    { locale: 'en', code: 'operation-failed', message: 'The plugin command could not be completed.' },
  ] as const)('shows a safe $code message in $locale', async ({ locale, code, message }) => {
    const execute = vi.fn(async () => {
      throw Object.assign(new Error('private plugin details'), { code });
    });
    const wrapper = mount(PluginToolWorkbench, {
      props: { tool, execute },
      global: { plugins: [createI18n({ legacy: false, locale, messages: { en: {}, zh: {} } })] },
    });

    await wrapper.get('input').setValue('Ada');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(message);
    expect(wrapper.text()).not.toContain('private plugin details');
  });
});
