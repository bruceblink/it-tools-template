import { get, useStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { onScopeDispose, shallowRef } from 'vue';
import { Puzzle } from '@vicons/tabler';
import type { MaybeRef, Ref } from 'vue';
import type { ToolCategory, ToolReference, ToolWithCategory } from './tools.types';
import { projectExternalPluginTools as projectExternalPluginToolRegistry } from './external-plugin-tools';
import { createQueuedRefresh } from './queued-refresh';
import { toolsWithCategory } from './index';
import { externalPluginV2Registry } from './external-plugin-v2-registry';
import { projectExternalPluginV2Manifest } from './external-plugin-v2-tools';
import { validateExternalPluginV2Manifest } from '@/shared/external-plugin-v2';
import type { PluginToolCommandExecutor, PluginToolCommandResult } from '@/shared/plugin-tool-workbench';

const externalPluginToolComponent = () => import('@/pages/ExternalPluginTool.page.vue');
const externalPluginV2ToolComponent = () => import('@/pages/ExternalPluginV2Tool.page.vue');
function projectDesktopExternalPluginTools(snapshots: readonly DesktopPluginSnapshot[]): ToolWithCategory[] {
  return projectExternalPluginToolRegistry(snapshots, {
    component: externalPluginToolComponent,
    icon: Puzzle,
  });
}

function createExternalPluginV2CommandExecutor(): PluginToolCommandExecutor {
  return async (request, signal): Promise<PluginToolCommandResult> => {
    if (signal.aborted) {
      throw new Error('The plugin command was cancelled.');
    }
    const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
    if (!bridge?.executePluginV2Command) {
      throw new Error('The v2 plugin command bridge is not available.');
    }
    const result = await bridge.executePluginV2Command({
      pluginId: request.pluginId,
      version: request.version,
      commandId: request.commandId,
      input: request.input,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    if (!isPluginToolCommandResult(result.value)) {
      throw new Error('The v2 plugin returned an invalid command result.');
    }
    return result.value;
  };
}

function isPluginToolCommandResult(value: unknown): value is PluginToolCommandResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'text') {
    return typeof record.value === 'string';
  }
  return record.kind === 'json' && isJsonValue(record.value);
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 16 || value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value === null || typeof value === 'string' || typeof value === 'boolean';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(item => isJsonValue(item, depth + 1));
  }
  if (typeof value !== 'object') {
    return false;
  }
  return Object.values(value).every(item => isJsonValue(item, depth + 1));
}

async function refreshExternalPluginV2Tools(): Promise<void> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge?.listPluginV2Packages) {
    return;
  }
  externalPluginV2Registry.clear();
  try {
    const result = await bridge.listPluginV2Packages();
    if (!result.ok) {
      return;
    }
    const execute = createExternalPluginV2CommandExecutor();
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
        externalPluginV2Registry.register(projection, execute);
      }
      catch {
        // 单个包的静态元数据无效时跳过该包，保留其他工具和导航。
      }
    }
  }
  catch {
    externalPluginV2Registry.clear();
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
