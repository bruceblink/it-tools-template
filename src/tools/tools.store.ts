import { get, useStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import type { MaybeRef, Ref } from 'vue';
import _ from 'lodash';
import type { ToolCategory, ToolReference, ToolWithCategory } from './tools.types';
import { toolsWithCategory } from './index';

export const useToolStore = defineStore('tools', () => {
  const favoriteToolsName = useStorage('favoriteToolsName', []) as Ref<string[]>;
  const { t } = useI18n();

  const tools = computed<ToolWithCategory[]>(() => toolsWithCategory.map((tool) => {
    return ({
      ...tool,
      name: t(`tools.${tool.translationKey}.title`, tool.name),
      description: t(`tools.${tool.translationKey}.description`, tool.description),
      category: t(`tools.categories.${tool.categoryId}`, tool.category),
    });
  }));

  const toolsByCategory = computed<ToolCategory[]>(() => {
    return _.chain(tools.value)
      .groupBy('categoryId')
      .map((components, id) => ({
        id,
        name: components[0]?.category ?? id,
        components,
      }))
      .value();
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
