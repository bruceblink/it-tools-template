import type {
  ExternalPluginV2Manifest,
  ExternalPluginV2SettingDeclaration,
  ExternalPluginV2ToolDeclaration,
} from '../src/shared/external-plugin-v2';
import { PluginSettingsStore, type PluginSettingValue } from './plugin-settings-store';

/** 读取 v2 工具声明的设置，并把无效或缺失的持久化值回退到清单默认值。 */
export async function readExternalPluginV2ToolSettings(
  manifest: Pick<ExternalPluginV2Manifest, 'id' | 'contributions'>,
  tool: Pick<ExternalPluginV2ToolDeclaration, 'settings'>,
  settingsStore: PluginSettingsStore,
): Promise<Readonly<Record<string, string | number | boolean>>> {
  const declarations = new Map(manifest.contributions.settings?.map(setting => [setting.id, setting]) ?? []);
  const values: Record<string, string | number | boolean> = {};
  for (const settingId of tool.settings ?? []) {
    const declaration = declarations.get(settingId);
    if (!declaration) {
      continue;
    }
    const settingKey = getSettingKey(settingId, manifest.id);
    const stored = await readStoredSetting(settingsStore, manifest.id, settingKey);
    values[settingId] = isValidStoredValue(declaration, stored) ? stored : declaration.defaultValue;
  }
  return values;
}

function getSettingKey(settingId: string, pluginId: string): string {
  const prefix = `${pluginId}/`;
  return settingId.startsWith(prefix) ? settingId.slice(prefix.length) : settingId;
}

async function readStoredSetting(
  settingsStore: PluginSettingsStore,
  pluginId: string,
  settingKey: string,
): Promise<PluginSettingValue | undefined> {
  try {
    return await settingsStore.read(pluginId, settingKey);
  }
  catch {
    // 设置存储不可用时，调用方仍可使用声明的默认值执行工具。
    return undefined;
  }
}

function isValidStoredValue(
  declaration: ExternalPluginV2SettingDeclaration,
  value: PluginSettingValue | undefined,
): value is string | number | boolean {
  if (declaration.type === 'string') {
    return typeof value === 'string' && value.length <= (declaration.maxLength ?? 4_096);
  }
  if (declaration.type === 'boolean') {
    return typeof value === 'boolean';
  }
  return typeof value === 'number'
    && Number.isFinite(value)
    && (declaration.integer !== true || Number.isSafeInteger(value))
    && (declaration.minimum === undefined || value >= declaration.minimum)
    && (declaration.maximum === undefined || value <= declaration.maximum);
}
