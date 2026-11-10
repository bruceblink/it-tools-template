import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import PluginToolWorkbench from './PluginToolWorkbench.page.vue';
import type { PluginToolCommandExecutor, PluginToolWorkbenchDefinition } from '@/shared/plugin-tool-workbench';

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

// 通过 integer 属性区分安全整数输入和仅设置控件步进量的旧数字字段。
function createNumberTool(integer?: boolean): PluginToolWorkbenchDefinition {
  return {
    ...tool,
    fields: [{
      id: 'count',
      type: 'number',
      label: 'Count',
      required: true,
      minimum: 0,
      maximum: 1_000_000,
      step: 1,
      ...(integer === undefined ? {} : { integer }),
    }],
  };
}

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

  it.each([
    { locale: 'en', value: '1.5', message: 'Count must be a safe integer.' },
    { locale: 'zh', value: '1.5', message: 'Count：请输入安全整数。' },
  ] as const)('rejects non-safe integer values in $locale', async ({ locale, value, message }) => {
    const execute = vi.fn<PluginToolCommandExecutor>();
    const wrapper = mount(PluginToolWorkbench, {
      props: { tool: createNumberTool(true), execute },
      global: { plugins: [createI18n({ legacy: false, locale, messages: { en: {}, zh: {} } })] },
    });

    await wrapper.get('input').setValue(value);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(execute).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe(message);
  });

  it('executes an integer field with a safe integer value', async () => {
    const execute = vi.fn(async (request: Parameters<PluginToolCommandExecutor>[0]) => ({
      kind: 'json' as const,
      value: { count: request.input.count ?? null },
    }));
    const wrapper = mount(PluginToolWorkbench, {
      props: { tool: createNumberTool(true), execute },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
    });

    await wrapper.get('input').setValue('21');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].input.count).toBe(21);
    expect(wrapper.text()).toContain('"count": 21');
  });

  it('keeps step as a control increment when an older number field omits integer', async () => {
    const execute = vi.fn(async (request: Parameters<PluginToolCommandExecutor>[0]) => ({
      kind: 'json' as const,
      value: { count: request.input.count ?? null },
    }));
    const wrapper = mount(PluginToolWorkbench, {
      props: { tool: createNumberTool(), execute },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
    });

    await wrapper.get('input').setValue('1.5');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].input.count).toBe(1.5);
    expect(wrapper.text()).toContain('"count": 1.5');
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
