import type { Component } from 'vue';

export type ToolPlatform = 'web' | 'electron';

export type ToolDataProcessing = 'memory-only' | 'local-data' | 'user-selected-files' | 'network' | 'unspecified';

export type ToolOfflineSupport = 'available' | 'requires-network' | 'conditional' | 'unknown';

export type ToolCapability = 'clipboard.write' | 'file.read' | 'file.save' | 'device.camera' | 'runtime.info' | 'data.oui';

export interface Tool {
  id?: string
  categoryId?: string
  name: string
  path: string
  aliases?: string[]
  translationKey: string
  description: string
  keywords: string[]
  component: () => Promise<Component>
  icon: Component
  redirectFrom?: string[]
  platforms?: ToolPlatform[]
  dataProcessing?: ToolDataProcessing
  offline?: ToolOfflineSupport
  capabilities?: ToolCapability[]
  extensionOwned?: boolean
  isNew: boolean
  createdAt?: Date
}

export type ToolDefinition = Tool & Required<Pick<Tool, 'id' | 'categoryId' | 'translationKey' | 'platforms' | 'dataProcessing' | 'offline' | 'capabilities'>>;

export type ToolReference = Pick<Tool, 'name' | 'path'>;

export type ToolConfig = Omit<Tool, 'id' | 'categoryId' | 'aliases' | 'translationKey' | 'platforms' | 'dataProcessing' | 'offline' | 'capabilities' | 'isNew'>
  & Partial<Pick<Tool, 'id' | 'categoryId' | 'aliases' | 'translationKey' | 'platforms' | 'dataProcessing' | 'offline' | 'capabilities' | 'isNew'>>;

export interface ToolCategory {
  id?: string
  name: string
  components: Tool[]
}

export type ToolWithCategory = Tool & { categoryId: string; category: string };
