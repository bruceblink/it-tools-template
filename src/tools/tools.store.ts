import { get, useStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { onScopeDispose, shallowRef } from 'vue';
import { Puzzle } from '@vicons/tabler';
import type { MaybeRef, Ref } from 'vue';
import type { ToolCategory, ToolReference, ToolWithCategory } from './tools.types';
import { projectExternalPluginTools as projectExternalPluginToolRegistry } from './external-plugin-tools';
import { createQueuedRefresh } from './queued-refresh';
import { toolsWithCategory } from './index';
import { ExternalPluginV2Registry, externalPluginV2Registry } from './external-plugin-v2-registry';
import { projectExternalPluginV2Manifest } from './external-plugin-v2-tools';
import { validateExternalPluginV2Manifest } from '@/shared/external-plugin-v2';
import { isPluginToolCommandResult, type PluginToolCommandExecutor, type PluginToolCommandResult } from '@/shared/plugin-tool-workbench';
import type { DesktopPluginErrorCode } from '@/shared/desktop-services/plugins';

const externalPluginToolComponent = () => import('@/pages/ExternalPluginTool.page.vue');
const externalPluginV2ToolComponent = () => import('@/pages/ExternalPluginV2Tool.page.vue');
function projectDesktopExternalPluginTools(snapshots: readonly DesktopPluginSnapshot[]): ToolWithCategory[] {
  return projectExternalPluginToolRegistry(snapshots, {
    component: externalPluginToolComponent,
    icon: Puzzle,
  });
}

export function createExternalPluginV2CommandExecutor(): PluginToolCommandExecutor {
  return async (request, signal): Promise<PluginToolCommandResult> => {
    if (signal.aborted) {
      throw createPluginToolCommandError('cancelled');
    }
    const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
    if (!bridge?.executePluginV2Command) {
      throw new Error('The v2 plugin command bridge is not available.');
    }
    const requestId = crypto.randomUUID();
    const resultPromise = bridge.executePluginV2Command({
      requestId,
      pluginId: request.pluginId,
      version: request.version,
      commandId: request.commandId,
      input: request.input,
    });
    const settledResultPromise = resultPromise.then(
      result => ({ ok: true as const, result }),
      error => ({ ok: false as const, error }),
    );
    const cancel = () => {
      const cancelPromise = bridge.cancelPluginV2Command?.(requestId);
      if (cancelPromise) {
        void cancelPromise.catch(() => undefined);
      }
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) {
        cancel();
        void settledResultPromise;
        throw createPluginToolCommandError('cancelled');
      }
      const settled = await settledResultPromise;
      if (!settled.ok) {
        throw settled.error;
      }
      const result = settled.result;
      if (signal.aborted) {
        throw createPluginToolCommandError('cancelled');
      }
      if (!result.ok) {
        throw createPluginToolCommandError(result.error);
      }
      if (!isPluginToolCommandResult(result.value)) {
        throw new Error('The v2 plugin returned an invalid command result.');
      }
      return result.value;
    }
    finally {
      signal.removeEventListener('abort', cancel);
    }
  };
}

/** 只向工作台传递稳定错误码；不把 IPC 错误文本或插件输入放进异常消息。 */
function createPluginToolCommandError(code: DesktopPluginErrorCode): Error & {
  readonly code: 'timeout' | 'cancelled' | 'operation-failed';
} {
  const safeCode: 'timeout' | 'cancelled' | 'operation-failed' = code === 'timeout' || code === 'cancelled'
    ? code
    : 'operation-failed';
  return Object.assign(new Error('The plugin command could not be completed.'), { code: safeCode });
}

async function refreshExternalPluginV2Tools(): Promise<void> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge?.listPluginV2Packages) {
    externalPluginV2Registry.initialized.value = true;
    return;
  }
  try {
    const result = await bridge.listPluginV2Packages();
    if (!result.ok) {
      console.warn('Could not list installed v2 plugin packages.', result.error);
      return;
    }
    const execute = createExternalPluginV2CommandExecutor();
    const nextRegistry = new ExternalPluginV2Registry();
    for (const snapshot of result.value) {
      if (snapshot.status !== 'installed') {
        continue;
      }
      try {
        const manifest = validateExternalPluginV2Manifest(snapshot.manifest);
        const projection = projectExternalPluginV2Manifest(manifest, {
          component: externalPluginV2ToolComponent,
          icon: Puzzle,
        });
        nextRegistry.register(projection, execute, JSON.stringify(manifest), {
          runtimeStatus: snapshot.runtimeStatus,
          ...(snapshot.runtimeFailureCode === undefined ? {} : { runtimeFailureCode: snapshot.runtimeFailureCode }),
        });
      }
      catch (error) {
        // 单个包的静态元数据无效时跳过该包，保留其他工具和导航。
        console.warn('Skipping invalid v2 plugin contribution.', {
          pluginId: snapshot.pluginId,
          version: snapshot.version,
          error: error instanceof Error ? error.message : 'Unknown validation error.',
        });
      }
    }
    // 先完成清单检查，再替换索引，避免刷新时卸载正在使用的工作台。
    externalPluginV2Registry.replaceFrom(nextRegistry);
  }
  catch (error) {
    console.warn('Could not register installed v2 plugin tools.', error instanceof Error ? error.message : 'Unknown registry error.');
  }
  finally {
    externalPluginV2Registry.initialized.value = true;
  }
}

export const useToolStore = defineStore('tools', () => {
  const favoriteToolsName = useStorage('favoriteToolsName', []) as Ref<string[]>;
  const { t } = useI18n();
  const externalPluginTools = shallowRef<ToolWithCategory[]>([]);
  const refreshExternalPluginTools = createQueuedRefresh(async () => {
    const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
    if (!bridge) {
      externalPluginTools.value = [];
      externalPluginV2Registry.clear();
      externalPluginV2Registry.initialized.value = true;
      return;
    }
    try {
      const [legacyResult] = await Promise.all([
        bridge.listPlugins?.() ?? Promise.resolve({ ok: true as const, value: [] as DesktopPluginSnapshot[] }),
        refreshExternalPluginV2Tools(),
      ]);
      externalPluginTools.value = legacyResult.ok ? projectDesktopExternalPluginTools(legacyResult.value) : [];
    }
    catch {
      externalPluginTools.value = [];
    }
  });

  const disposePluginStateChange = typeof window === 'undefined'
    ? undefined
    : window.itToolsDesktop?.onPluginStateChanged?.(() => {
      void refreshExternalPluginTools();
    });
  onScopeDispose(() => disposePluginStateChange?.());
  void refreshExternalPluginTools();

  const tools = computed<ToolWithCategory[]>(() => [
    ...toolsWithCategory,
    ...externalPluginTools.value,
    ...externalPluginV2Registry.tools.value,
  ].map((tool) => {
    return ({
      ...tool,
      name: t(`tools.${tool.translationKey}.title`, tool.name),
      description: t(`tools.${tool.translationKey}.description`, tool.description),
      category: t(`tools.categories.${tool.categoryId}`, tool.category),
    });
  }));

  const toolsByCategory = computed<ToolCategory[]>(() => {
    const categories = new Map<string, ToolWithCategory[]>();
    for (const tool of tools.value) {
      const components = categories.get(tool.categoryId) ?? [];
      components.push(tool);
      categories.set(tool.categoryId, components);
    }
    return [...categories].map(([id, components]) => ({
      id,
      name: components[0]?.category ?? id,
      components,
    }));
  });

  const favoriteTools = computed(() => {
    return favoriteToolsName.value
      .map(favoriteName => tools.value.find(({ name, path }) => name === favoriteName || path === favoriteName))
      .filter(Boolean) as ToolWithCategory[]; // cast because .filter(Boolean) does not remove undefined from type
  });

  return {
    tools,
    favoriteTools,
    toolsByCategory,
    newTools: computed(() => tools.value.filter(({ isNew }) => isNew)),

    addToolToFavorites({ tool }: { tool: MaybeRef<ToolReference> }) {
      const toolPath = get(tool).path;
      if (toolPath) {
        favoriteToolsName.value.push(toolPath);
      }
    },

    removeToolFromFavorites({ tool }: { tool: MaybeRef<ToolReference> }) {
      favoriteToolsName.value = favoriteToolsName.value.filter(name => get(tool).name !== name && get(tool).path !== name);
    },

    isToolFavorite({ tool }: { tool: MaybeRef<ToolReference> }) {
      return favoriteToolsName.value.includes(get(tool).name)
        || favoriteToolsName.value.includes(get(tool).path);
    },

    updateFavoriteTools(newOrder: ToolWithCategory[]) {
      favoriteToolsName.value = newOrder.map(tool => tool.path);
    },
  };
});
