import { createApp, defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExternalPluginV2CommandExecutor } from './tools.store';
import type { PluginToolCommandResult } from '@/shared/plugin-tool-workbench';
import { useToolStore } from './tools.store';
import { externalPluginV2Registry } from './external-plugin-v2-registry';

describe('external plugin v2 command bridge', () => {
  const previousBridge = window.itToolsDesktop;

  afterEach(() => {
    Object.defineProperty(window, 'itToolsDesktop', { configurable: true, writable: true, value: previousBridge });
    externalPluginV2Registry.clear();
  });

  it('cancels an IPC request when its signal aborts before the response settles', async () => {
    const controller = new AbortController();
    let rejectExecution!: (error: Error) => void;
    let executionInput: { requestId: string } | undefined;
    const cancel = vi.fn(async () => ({ ok: true as const, value: true }));
    const execute = vi.fn((input: { requestId: string }) => {
      executionInput = input;
      controller.abort();
      return new Promise<DesktopPluginOperationResult<PluginToolCommandResult>>((_resolve, reject) => {
        rejectExecution = reject;
      });
    });
    Object.defineProperty(window, 'itToolsDesktop', {
      configurable: true,
      writable: true,
      value: { executePluginV2Command: execute, cancelPluginV2Command: cancel },
    });
    const executor = createExternalPluginV2CommandExecutor();

    const execution = executor({
      pluginId: 'org.example.demo',
      version: '1.0.0',
      toolId: 'org.example.demo/echo',
      commandId: 'org.example.demo/echo',
      input: {},
    }, controller.signal);
    await expect(execution).rejects.toThrow('cancelled');
    expect(cancel).toHaveBeenCalledWith(executionInput?.requestId);

    rejectExecution(new Error('late IPC failure'));
    await Promise.resolve();
  });

  it('registers the signed WASM E2E manifest shape after the desktop list refresh', async () => {
    const pluginId = 'org.it-tools.wasm-e2e';
    const snapshot: DesktopPluginV2Snapshot = {
      pluginId,
      name: 'WASM execution demo',
      version: '1.0.0',
      runtime: 'wasm',
      status: 'installed',
      manifest: {
        formatVersion: 2,
        id: pluginId,
        name: 'WASM execution demo',
        version: '1.0.0',
        apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
        requestedCapabilities: [],
        activationEvents: [`onTool:${pluginId}/echo`, `onCommand:${pluginId}/run-echo`],
        contributions: {
          tools: [{
            id: `${pluginId}/echo`,
            title: 'Signed WASM echo',
            description: 'Run a signed WASM command with the host-rendered workspace.',
            keywords: ['wasm', 'signed', 'extension'],
            categoryId: 'development',
            dataProcessing: 'memory-only',
            offline: 'available',
            capabilities: [],
            inputs: [{ id: 'spin', kind: 'boolean', label: 'Spin forever', defaultValue: false }],
            output: { kind: 'json' },
          }],
          commands: [{
            id: `${pluginId}/run-echo`,
            title: 'Run signed WASM echo',
            description: 'Run a signed WASM extension command.',
            keywords: ['wasm', 'signed', 'extension'],
            toolId: `${pluginId}/echo`,
          }],
        },
      },
    };
    let store: ReturnType<typeof useToolStore> | undefined;
    const pinia = createPinia();
    const app = createApp(defineComponent({
      setup() {
        store = useToolStore();
        return () => null;
      },
    }));
    app.use(pinia);
    app.use(createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false, warnHtmlMessage: false }));
    setActivePinia(pinia);
    let notifyChange!: () => void;
    let finishRefresh!: (result: DesktopPluginOperationResult<DesktopPluginV2Snapshot[]>) => void;
    const listV2 = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [snapshot] })
      .mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }))
      .mockResolvedValueOnce({ ok: false, error: 'operation-failed' })
      .mockResolvedValueOnce({ ok: true, value: [] });
    Object.defineProperty(window, 'itToolsDesktop', {
      configurable: true,
      writable: true,
      value: {
        listPlugins: vi.fn(async () => ({ ok: true as const, value: [] })),
        listPluginV2Packages: listV2,
        onPluginStateChanged: (callback: () => void) => { notifyChange = callback; return () => {}; },
      },
    });
    app.mount(document.createElement('div'));
    try {
      await flushPromises();
      expect(store?.tools.some(tool => tool.path === `/extensions/${pluginId}/1.0.0/echo`)).toBe(true);
      const path = `/extensions/${pluginId}/1.0.0/echo`;
      const registration = externalPluginV2Registry.findByRoute(path);

      // 刷新期间和同一清单重新加载后都保留原工作台，避免丢失输入或取消命令。
      notifyChange();
      expect(externalPluginV2Registry.findByRoute(path)).toBe(registration);
      finishRefresh({ ok: true, value: [snapshot] });
      await flushPromises();
      expect(externalPluginV2Registry.findByRoute(path)).toBe(registration);

      // 读取失败保留上一份索引；下一次成功读取仍会移除已卸载插件。
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      notifyChange();
      await flushPromises();
      expect(externalPluginV2Registry.findByRoute(path)).toBe(registration);
      expect(warning).toHaveBeenCalled();
      warning.mockRestore();

      notifyChange();
      await flushPromises();
      expect(externalPluginV2Registry.findByRoute(path)).toBeUndefined();
    }
    finally {
      app.unmount();
      setActivePinia(undefined);
    }
  });
});
