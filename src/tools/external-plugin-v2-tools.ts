import type { Component } from 'vue';
import type {
  ExternalPluginV2CommandDeclaration,
  ExternalPluginV2InputField,
  ExternalPluginV2Manifest,
  ExternalPluginV2ToolDeclaration,
} from '@/shared/external-plugin-v2';
import type { PluginToolInputField, PluginToolWorkbenchDefinition } from '@/shared/plugin-tool-workbench';
import { getExternalPluginToolRoute } from '@/shared/plugin-tool-route';
import type { ToolCategory, ToolDefinition, ToolPlatform, ToolWithCategory } from './tools.types';
import { createValidatedToolRegistry } from './tool-registry';

/** 提供 v2 工具的宿主组件和图标。外部扩展只能提供声明式数据。 */
export interface ExternalPluginV2ToolProjectionOptions {
  component: () => Promise<Component>;
  icon: Component;
  categoryNames?: Readonly<Record<string, string>>;
}

/** 命令搜索需要的静态数据。执行动作由扩展宿主适配器在更高层绑定。 */
export interface ExternalPluginV2CommandIndexEntry {
  readonly pluginId: string;
  readonly version: string;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly toolId?: string;
  readonly targetPath?: string;
}

export interface ExternalPluginV2ToolRegistration {
  readonly tool: ToolWithCategory;
  readonly workbench: PluginToolWorkbenchDefinition;
}

export interface ExternalPluginV2RegistryProjection {
  readonly categories: readonly ToolCategory[];
  readonly tools: readonly ToolWithCategory[];
  readonly registrations: readonly ExternalPluginV2ToolRegistration[];
  readonly commands: readonly ExternalPluginV2CommandIndexEntry[];
}

/** 将已验证的 v2 清单转换为现有工具注册表和命令索引需要的元数据。 */
export function projectExternalPluginV2Manifest(
  manifest: ExternalPluginV2Manifest,
  options: ExternalPluginV2ToolProjectionOptions,
): ExternalPluginV2RegistryProjection {
  const commandsByToolId = indexToolCommands(manifest.contributions.commands);
  const registrations = manifest.contributions.tools.map(tool => {
    const command = commandsByToolId.get(tool.id);
    if (!command) {
      throw new Error(`Plugin tool ${tool.id} must declare exactly one command.`);
    }
    const workbench = toWorkbenchDefinition(manifest, tool, command);
    const projectedTool = toToolDefinition(manifest, tool, options);
    return { tool: projectedTool, workbench };
  });

  const categories = createCategories(registrations.map(({ tool }) => tool), options.categoryNames);
  const validated = createValidatedToolRegistry(categories, 'extension');
  const toolsById = new Map(validated.toolsWithCategory.map(tool => [tool.id, tool]));
  const validatedRegistrations = registrations.map(registration => {
    const toolId = registration.tool.id;
    const tool = toolsById.get(toolId);
    if (!tool) {
      throw new Error(`Plugin tool ${toolId} was not published by the registry.`);
    }
    return { ...registration, tool };
  });

  return {
    categories: validated.categories,
    tools: validated.toolsWithCategory,
    registrations: validatedRegistrations,
    commands: manifest.contributions.commands.map(command => toCommandIndexEntry(manifest, command)),
  };
}

function indexToolCommands(
  commands: readonly ExternalPluginV2CommandDeclaration[],
): Map<string, ExternalPluginV2CommandDeclaration> {
  const commandsByToolId = new Map<string, ExternalPluginV2CommandDeclaration>();
  for (const command of commands) {
    if (!command.toolId) {
      continue;
    }
    if (commandsByToolId.has(command.toolId)) {
      throw new Error(`Plugin tool ${command.toolId} must declare exactly one command.`);
    }
    commandsByToolId.set(command.toolId, command);
  }
  return commandsByToolId;
}

function toToolDefinition(
  manifest: ExternalPluginV2Manifest,
  declaration: ExternalPluginV2ToolDeclaration,
  options: ExternalPluginV2ToolProjectionOptions,
): ToolDefinition {
  const path = getExternalPluginToolRoute(manifest.id, manifest.version, declaration.id);
  return {
    id: `external-v2/${manifest.id}/${manifest.version}/${declaration.id}`,
    categoryId: declaration.categoryId,
    name: declaration.title,
    path,
    translationKey: getTranslationKey(manifest.id, declaration.id),
    description: declaration.description,
    keywords: [...new Set([...declaration.keywords, 'plugin', 'extension'])],
    component: options.component,
    icon: options.icon,
    platforms: ['electron'] satisfies ToolPlatform[],
    dataProcessing: declaration.dataProcessing,
    offline: declaration.offline,
    capabilities: [...declaration.capabilities],
    extensionOwned: true,
    isNew: false,
  };
}

function createCategories(
  tools: readonly ToolDefinition[],
  categoryNames: Readonly<Record<string, string>> | undefined,
): ToolCategory[] {
  const categories = new Map<string, ToolCategory>();
  for (const tool of tools) {
    const category = categories.get(tool.categoryId);
    if (category) {
      category.components.push(tool);
      continue;
    }
    categories.set(tool.categoryId, {
      id: tool.categoryId,
      name: categoryNames?.[tool.categoryId]?.trim() || tool.categoryId,
      components: [tool],
    });
  }
  return [...categories.values()];
}

function toWorkbenchDefinition(
  manifest: ExternalPluginV2Manifest,
  declaration: ExternalPluginV2ToolDeclaration,
  command: ExternalPluginV2CommandDeclaration,
): PluginToolWorkbenchDefinition {
  const fields = declaration.inputs.map(toWorkbenchField);
  return {
    pluginId: manifest.id,
    version: manifest.version,
    toolId: declaration.id,
    title: declaration.title,
    description: declaration.description,
    commandId: command.id,
    fields,
    resultKind: declaration.output.kind,
  };
}

function toWorkbenchField(field: ExternalPluginV2InputField): PluginToolInputField {
  const base = {
    id: field.id,
    label: field.label,
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.required === undefined ? {} : { required: field.required }),
  };
  if (field.kind === 'text') {
    return {
      ...base,
      type: field.multiline ? 'textarea' : 'text',
      ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
    };
  }
  if (field.kind === 'number') {
    return {
      ...base,
      type: 'number',
      ...(field.integer === undefined ? {} : { integer: field.integer }),
      ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
      ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
      ...(field.step === undefined ? {} : { step: field.step }),
    };
  }
  if (field.kind === 'boolean') {
    return {
      ...base,
      type: 'boolean',
      ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
    };
  }
  return {
    ...base,
    type: 'select',
    options: field.options.map(option => ({ label: option.label, value: option.value })),
    ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
  };
}

function toCommandIndexEntry(
  manifest: ExternalPluginV2Manifest,
  command: ExternalPluginV2CommandDeclaration,
): ExternalPluginV2CommandIndexEntry {
  return {
    pluginId: manifest.id,
    version: manifest.version,
    id: command.id,
    title: command.title,
    description: command.description,
    keywords: [...command.keywords],
    ...(command.toolId === undefined ? {} : {
      toolId: command.toolId,
      targetPath: getExternalPluginToolRoute(manifest.id, manifest.version, command.toolId),
    }),
  };
}

function getTranslationKey(pluginId: string, contributionId: string): string {
  const slug = `${pluginId}-${contributionId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `external-plugin-${slug.slice(0, 96)}`;
}
