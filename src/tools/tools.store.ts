import { get, useStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { onScopeDispose, shallowRef } from 'vue';
import { Puzzle } from '@vicons/tabler';
import type { MaybeRef, Ref } from 'vue';
import type { ToolCategory, ToolReference, ToolWithCategory } from './tools.types';
import { projectExternalPluginTools as projectExternalPluginToolRegistry } from './external-plugin-tools';
import { createQueuedRefresh } from './queued-refresh';
import { toolsWithCategory } from './index';

const externalPluginToolComponent = () => import('@/pages/ExternalPluginTool.page.vue');
function projectDesktopExternalPluginTools(snapshots: readonly DesktopPluginSnapshot[]): ToolWithCategory[] {
  return projectExternalPluginToolRegistry(snapshots, {
    component: externalPluginToolComponent,
    icon: Puzzle,
  });
}

export const useToolStore = defineStore('tools', () => {
  const favoriteToolsName = useStorage('favoriteToolsName', []) as Ref<string[]>;
  const { t } = useI18n();
  const externalPluginTools = shallowRef<ToolWithCategory[]>([]);
  const refreshExternalPluginTools = createQueuedRefresh(async () => {
    const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
    if (!bridge?.listPlugins) {
      externalPluginTools.value = [];
      return;
    }
    try {
      const result = await bridge.listPlugins();
      externalPluginTools.value = result.ok ? projectDesktopExternalPluginTools(result.value) : [];
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

  const tools = computed<ToolWithCategory[]>(() => [...toolsWithCategory, ...externalPluginTools.value].map((tool) => {
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
