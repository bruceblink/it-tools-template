import type { Tool, ToolConfig } from './tools.types';

const newToolThreshold = new Date();
newToolThreshold.setDate(newToolThreshold.getDate() - 14);

/** Keep the full definition in development for registry validation; production routes only carry UI fields. */
export function defineTool(tool: ToolConfig): Tool {
  const isNew = tool.isNew ?? (tool.createdAt ? tool.createdAt.getTime() > newToolThreshold.getTime() : false);
  const translationKey = tool.translationKey ?? tool.path.replace(/^\/+/, '').replace(/\//g, '');
  if (import.meta.env.DEV) {
    return { ...tool, translationKey, isNew };
  }

  return {
    name: tool.name,
    path: tool.path,
    aliases: tool.aliases,
    translationKey,
    description: tool.description,
    keywords: tool.keywords,
    component: tool.component,
    icon: tool.icon,
    redirectFrom: tool.redirectFrom,
    ...(tool.platforms?.length === 1 ? { platforms: tool.platforms } : {}),
    ...(tool.contentWidth ? { contentWidth: tool.contentWidth } : {}),
    ...(tool.extensionOwned ? { extensionOwned: true } : {}),
    isNew,
  };
}
