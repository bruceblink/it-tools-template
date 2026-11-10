import type { RouteMeta } from 'vue-router';
import type { ToolWithCategory } from '@/tools/tools.types';

export const legacyExternalPluginToolMeta = {
  name: 'External plugin tool',
  description: 'Run an installed plugin tool inside the IT Tools workspace.',
  keywords: ['plugin', 'external', 'desktop'],
  translationKey: 'external-plugin-tool',
  contentWidth: 'wide' as const,
};

/** 在 v2 元数据异步到达时，把宿主路由更新为工具清单中的内容。 */
export function applyExternalPluginV2RouteMeta(
  meta: RouteMeta,
  tool: Pick<ToolWithCategory, 'name' | 'description' | 'keywords' | 'translationKey'>,
): void {
  Object.assign(meta, {
    name: tool.name,
    description: tool.description,
    keywords: tool.keywords,
    translationKey: tool.translationKey,
    contentWidth: undefined,
  });
}

/** v2 工具从注册表移除后，恢复通用插件路由的默认内容。 */
export function restoreLegacyExternalPluginRouteMeta(meta: RouteMeta): void {
  Object.assign(meta, legacyExternalPluginToolMeta);
}
