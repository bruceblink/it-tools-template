import type { Tool, ToolCategory, ToolWithCategory } from './tools.types';
import { pluginCapabilityIds } from '../shared/plugin-capabilities';
import { isToolDataProcessing, isToolOfflineSupport } from '../shared/plugin-tool-metadata';

const reservedPaths = new Set(['/','/about']);
const supportedPlatforms = new Set(['web', 'electron']);
const knownCapabilities = new Set(pluginCapabilityIds);

export type ToolRegistryValidationMode = 'builtin-compatibility' | 'extension';

function getCategoryId(category: ToolCategory): string {
  return category.id ?? category.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getBuiltinToolId(path: string): string {
  const localId = path.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  return `builtin/${localId}`;
}

function getTranslationKey(tool: Tool): string {
  return tool.translationKey ?? tool.path.replace(/^\/+/, '').replace(/\//g, '');
}

function normalizePath(path: string): string {
  return path.trim().replace(/\/+$/, '').toLowerCase() || '/';
}

function getToolAliases(tool: Pick<Tool, 'aliases' | 'redirectFrom'>): string[] {
  return tool.aliases ?? tool.redirectFrom ?? [];
}

function assertValidRoute(routes: Map<string, string>, path: string, toolId: string): void {
  if (!path.startsWith('/') || /[?#\\%\s]/.test(path) || path.split('/').some((part, index) => index > 0 && (!part || part === '.' || part === '..'))) {
    throw new Error(`Tool ${toolId} declares an invalid route: ${path}`);
  }

  const normalizedPath = normalizePath(path);
  if (reservedPaths.has(normalizedPath)) {
    throw new Error(`Tool ${toolId} cannot claim reserved route ${normalizedPath}.`);
  }
  const previousOwner = routes.get(normalizedPath);
  if (previousOwner) {
    throw new Error(`Tool route conflict at ${normalizedPath}: ${previousOwner} and ${toolId}.`);
  }
  routes.set(normalizedPath, toolId);
}

/** Validate definitions before publishing or accepting tool contributions. */
export function validateToolRegistry(categories: ToolCategory[], mode: ToolRegistryValidationMode = 'extension'): void {
  const categoryIds = new Set<string>();
  const toolIds = new Set<string>();
  const routeOwners = new Map<string, string>();

  for (const category of categories) {
    const categoryId = getCategoryId(category);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categoryId)) {
      throw new Error(`Invalid tool category id: ${categoryId}`);
    }
    if (categoryIds.has(categoryId)) {
      throw new Error(`Duplicate tool category id: ${categoryId}`);
    }
    if (!category.name.trim() || category.components.length === 0) {
      throw new Error(`Tool category ${categoryId} must have a name and at least one tool.`);
    }
    categoryIds.add(categoryId);

    for (const tool of category.components) {
      const requiresExplicitMetadata = mode === 'extension';
      if (requiresExplicitMetadata && (!tool.id || !tool.categoryId || !tool.translationKey || !tool.platforms || !tool.dataProcessing || !tool.offline || !tool.capabilities)) {
        throw new Error(`Tool ${tool.path} must declare id, category, translation, platform, data, offline, and capability metadata.`);
      }
      const toolId = tool.id ?? (mode === 'builtin-compatibility' ? getBuiltinToolId(tool.path) : '');
      if (!/^[a-z0-9][a-z0-9._:/-]*$/.test(toolId)) {
        throw new Error(`Invalid tool id: ${toolId}`);
      }
      if (toolIds.has(toolId)) {
        throw new Error(`Duplicate tool id: ${toolId}`);
      }
      if (tool.categoryId && tool.categoryId !== categoryId) {
        throw new Error(`Tool ${toolId} is listed under ${categoryId} but declares ${tool.categoryId}.`);
      }
      const translationKey = getTranslationKey(tool);
      if (!tool.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(translationKey)) {
        throw new Error(`Tool ${toolId} must declare a name and a valid translation key.`);
      }
      if (typeof tool.component !== 'function' || tool.icon === undefined || tool.icon === null) {
        throw new Error(`Tool ${toolId} must declare a lazy component and an icon.`);
      }
      if (tool.platforms && (tool.platforms.length === 0 || new Set(tool.platforms).size !== tool.platforms.length)) {
        throw new Error(`Tool ${toolId} must declare unique supported platforms.`);
      }
      if (tool.platforms?.some(platform => !supportedPlatforms.has(platform))) {
        throw new Error(`Tool ${toolId} declares an unsupported platform.`);
      }
      if ((tool.dataProcessing && !isToolDataProcessing(tool.dataProcessing)) || (tool.offline && !isToolOfflineSupport(tool.offline))) {
        throw new Error(`Tool ${toolId} declares invalid data or offline metadata.`);
      }
      if (tool.capabilities && new Set(tool.capabilities).size !== tool.capabilities.length) {
        throw new Error(`Tool ${toolId} declares duplicate capabilities.`);
      }
      if (tool.capabilities?.some(capability => !knownCapabilities.has(capability))) {
        throw new Error(`Tool ${toolId} requests an unknown capability.`);
      }

      toolIds.add(toolId);
      assertValidRoute(routeOwners, tool.path, toolId);
      for (const alias of getToolAliases(tool)) {
        assertValidRoute(routeOwners, alias, toolId);
      }
    }
  }
}

/** Build the shared views after definitions pass validation in tests or an extension loader. */
export function createToolRegistry(categories: ToolCategory[], mode: ToolRegistryValidationMode = 'builtin-compatibility') {
  const definitionsByCategory = categories.map((category) => {
    const categoryId = getCategoryId(category);
    const components = category.components.map(tool => ({
      ...tool,
      id: tool.id ?? (mode === 'builtin-compatibility' ? getBuiltinToolId(tool.path) : ''),
      translationKey: getTranslationKey(tool),
      categoryId: tool.categoryId ?? categoryId,
    }));
    return { ...category, id: categoryId, components };
  });

  const tools = definitionsByCategory.flatMap(({ components }) => components);
  const toolsWithCategory: ToolWithCategory[] = definitionsByCategory.flatMap(({ components, id, name }) =>
    components.map(tool => ({ ...tool, categoryId: id, category: name })),
  );
  return { categories: definitionsByCategory, tools, toolsWithCategory };
}

/** Use this entry point for runtime contributions so invalid data never reaches the router. */
export function createValidatedToolRegistry(categories: ToolCategory[], mode: ToolRegistryValidationMode = 'extension') {
  validateToolRegistry(categories, mode);
  return createToolRegistry(categories, mode);
}
