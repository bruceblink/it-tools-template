import type { RouteMeta } from 'vue-router';
import type { ToolWithCategory } from '@/tools/tools.types';

export const externalPluginToolRouteMeta = {
  name: 'Plugin tool',
  description: 'Run a host-rendered plugin tool inside the IT Tools workspace.',
  keywords: ['plugin', 'extension', 'desktop'],
  translationKey: 'external-plugin-tool',
  contentWidth: undefined,
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
