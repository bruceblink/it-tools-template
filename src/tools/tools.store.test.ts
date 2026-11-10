import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExternalPluginV2CommandExecutor } from './tools.store';
import type { PluginToolCommandResult } from '@/shared/plugin-tool-workbench';

describe('external plugin v2 command bridge', () => {
  const previousBridge = window.itToolsDesktop;

  afterEach(() => {
    Object.defineProperty(window, 'itToolsDesktop', { configurable: true, writable: true, value: previousBridge });
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
});
