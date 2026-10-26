import { get, useStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { onScopeDispose, shallowRef } from 'vue';
import { Puzzle } from '@vicons/tabler';
import type { MaybeRef, Ref } from 'vue';
import type { ToolCategory, ToolReference, ToolWithCategory } from './tools.types';
import { toolsWithCategory } from './index';

const externalPluginToolComponent = () => import('@/pages/ExternalPluginTool.page.vue');
const externalPluginCategoryId = 'external-plugins';

function getExternalPluginToolTranslationKey(pluginId: string, toolId: string): string {
  const slug = `${pluginId}-${toolId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `external-plugin-${slug.slice(0, 96)}`;
}

function projectExternalPluginTools(snapshots: readonly DesktopPluginSnapshot[]): ToolWithCategory[] {
  return snapshots
    .filter(plugin => plugin.status !== 'invalid')
    .flatMap(plugin => plugin.contributions.tools.map((contribution) => ({
      id: `external/${plugin.pluginId}/${plugin.version}/${contribution.id}`,
      categoryId: externalPluginCategoryId,
      category: 'External plugins',
      name: contribution.title,
      path: contribution.route,
      translationKey: getExternalPluginToolTranslationKey(plugin.pluginId, contribution.id),
      description: contribution.description,
      keywords: [...new Set([...contribution.keywords, 'plugin', 'external'])],
      component: externalPluginToolComponent,
      icon: Puzzle,
      platforms: ['electron'] as const,
      dataProcessing: contribution.dataProcessing,
      offline: contribution.offline,
      capabilities: [...contribution.capabilities],
      isNew: false,
    })));
}

export const useToolStore = defineStore('tools', () => {
  const favoriteToolsName = useStorage('favoriteToolsName', []) as Ref<string[]>;
  const { t } = useI18n();
  const externalPluginTools = shallowRef<ToolWithCategory[]>([]);
  let externalPluginRefresh: Promise<void> | undefined;

  async function refreshExternalPluginTools(): Promise<void> {
    const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
    if (!bridge?.listPlugins) {
      externalPluginTools.value = [];
      return;
    }
    if (externalPluginRefresh) {
      return externalPluginRefresh;
    }

    externalPluginRefresh = bridge.listPlugins()
      .then((result) => {
        externalPluginTools.value = result.ok ? projectExternalPluginTools(result.value) : [];
      })
      .catch(() => {
        externalPluginTools.value = [];
      })
      .finally(() => {
        externalPluginRefresh = undefined;
      });
    return externalPluginRefresh;
  }

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
