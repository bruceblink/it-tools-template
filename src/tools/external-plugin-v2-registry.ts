import { shallowRef, type ShallowRef } from 'vue';
import type {
  ExternalPluginV2CommandIndexEntry,
  ExternalPluginV2RegistryProjection,
  ExternalPluginV2ToolRegistration,
} from './external-plugin-v2-tools';
import type { PluginToolCommandExecutor } from '@/shared/plugin-tool-workbench';
import type { ToolWithCategory } from './tools.types';

export interface ExternalPluginV2RuntimeRegistration {
  readonly pluginId: string;
  readonly version: string;
  readonly tool: ToolWithCategory;
  readonly workbench: ExternalPluginV2ToolRegistration['workbench'];
  readonly execute: PluginToolCommandExecutor;
}

export interface ExternalPluginV2CommandIndexRegistration extends ExternalPluginV2CommandIndexEntry {
  readonly execute: PluginToolCommandExecutor;
}

/**
 * 保存已通过清单校验的 v2 贡献，并向工具导航、命令搜索和宿主工作台提供同一份运行时数据。
 * 注册表不执行插件代码；调用方必须显式提供扩展宿主 RPC 执行器。
 */
export class ExternalPluginV2Registry {
  readonly tools: ShallowRef<readonly ToolWithCategory[]> = shallowRef([]);
  readonly commands: ShallowRef<readonly ExternalPluginV2CommandIndexRegistration[]> = shallowRef([]);

  private readonly packages = new Map<string, PackageRegistration>();

  register(
    projection: ExternalPluginV2RegistryProjection,
    execute: PluginToolCommandExecutor,
    fingerprint?: string,
  ): void {
    const pluginId = projection.registrations[0]?.workbench.pluginId
      ?? projection.commands[0]?.pluginId;
    const version = projection.registrations[0]?.workbench.version
      ?? projection.commands[0]?.version;
    if (!pluginId || !version) {
      throw new Error('An external plugin v2 projection must declare a plugin identity.');
    }
    const packageKey = getPackageKey(pluginId, version);
    const registration = createPackageRegistration(projection, execute, pluginId, version, fingerprint);
    this.assertNoConflicts(packageKey, registration);
    this.packages.set(packageKey, registration);
    this.rebuildIndexes();
  }

  /** 一次替换完整索引；清单未变化的工具保留对象引用和工作台输入。 */
  replaceFrom(next: ExternalPluginV2Registry): void {
    const packages = [...next.packages.entries()].map(([key, registration]) => {
      const existing = this.packages.get(key);
      return [key, existing?.fingerprint !== undefined && existing.fingerprint === registration.fingerprint
        ? existing
        : registration] as const;
    });
    this.packages.clear();
    for (const [key, registration] of packages) {
      this.packages.set(key, registration);
    }
    this.rebuildIndexes();
  }

  unregister(pluginId: string, version?: string): void {
    if (version !== undefined) {
      this.packages.delete(getPackageKey(pluginId, version));
    }
    else {
      for (const packageKey of this.packages.keys()) {
        if (packageKey.startsWith(`${pluginId}@`)) {
          this.packages.delete(packageKey);
        }
      }
    }
    this.rebuildIndexes();
  }

  clear(): void {
    this.packages.clear();
    this.rebuildIndexes();
  }

  findByRoute(path: string): ExternalPluginV2RuntimeRegistration | undefined {
    for (const registration of this.getRuntimeRegistrations()) {
      if (registration.tool.path === path) {
        return registration;
      }
    }
    return undefined;
  }

  find(pluginId: string, version: string, toolId: string): ExternalPluginV2RuntimeRegistration | undefined {
    return this.getRuntimeRegistrations().find((registration) => (
      registration.pluginId === pluginId
      && registration.version === version
      && registration.workbench.toolId === toolId
    ));
  }

  getRuntimeRegistrations(): readonly ExternalPluginV2RuntimeRegistration[] {
    return [...this.packages.values()].flatMap(packageRegistration => packageRegistration.tools);
  }

  private assertNoConflicts(packageKey: string, registration: PackageRegistration): void {
    const existing = [...this.packages.entries()]
      .filter(([key]) => key !== packageKey)
      .flatMap(([, value]) => value.tools);
    const existingPaths = new Set(existing.map(tool => tool.tool.path));
    const existingIds = new Set(existing.map(tool => tool.tool.id));
    for (const tool of registration.tools) {
      if (existingPaths.has(tool.tool.path) || existingIds.has(tool.tool.id)) {
        throw new Error(`External plugin v2 tool conflicts with an existing route: ${tool.tool.path}`);
      }
    }
    const existingCommandIds = new Set([...this.commands.value]
      .filter(command => getPackageKey(command.pluginId, command.version) !== packageKey)
      .map(command => command.id));
    for (const command of registration.commands) {
      if (existingCommandIds.has(command.id)) {
        throw new Error(`External plugin v2 command conflicts with an existing command: ${command.id}`);
      }
    }
  }

  private rebuildIndexes(): void {
    const packages = [...this.packages.values()].sort((left, right) => left.key.localeCompare(right.key));
    this.tools.value = packages.flatMap(packageRegistration => packageRegistration.tools.map(tool => tool.tool));
    this.commands.value = packages.flatMap(packageRegistration => packageRegistration.commands);
  }
}

interface PackageRegistration {
  readonly key: string;
  readonly fingerprint?: string;
  readonly tools: readonly ExternalPluginV2RuntimeRegistration[];
  readonly commands: readonly ExternalPluginV2CommandIndexRegistration[];
}

function createPackageRegistration(
  projection: ExternalPluginV2RegistryProjection,
  execute: PluginToolCommandExecutor,
  pluginId: string,
  version: string,
  fingerprint?: string,
): PackageRegistration {
  const commandsById = new Map(projection.commands.map(command => [command.id, command]));
  const tools = projection.registrations.map(({ tool, workbench }) => ({
    pluginId,
    version,
    tool,
    workbench,
    execute,
  }));
  const commands = projection.commands.map(command => ({
    ...command,
    execute,
  }));
  for (const tool of tools) {
    if (!commandsById.has(tool.workbench.commandId)) {
      throw new Error(`External plugin v2 tool command is not indexed: ${tool.workbench.commandId}`);
    }
  }
  return {
    key: getPackageKey(pluginId, version),
    fingerprint,
    tools,
    commands,
  };
}

function getPackageKey(pluginId: string, version: string): string {
  return `${pluginId}@${version}`;
}

export const externalPluginV2Registry = new ExternalPluginV2Registry();
