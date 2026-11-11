import type {
  ExternalPluginV2Manifest,
  ExternalPluginV2SettingDeclaration,
  ExternalPluginV2SettingValue,
  ExternalPluginV2ToolDeclaration,
} from '../src/shared/external-plugin-v2';
import type {
  DesktopPluginV2SettingSnapshot,
  DesktopPluginV2SettingsSnapshot,
} from '../src/shared/desktop-services/plugins';
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

/** 读取宿主设置页需要的完整设置快照，并为缺失或无效值使用清单默认值。 */
export async function readExternalPluginV2Settings(
  manifest: Pick<ExternalPluginV2Manifest, 'id' | 'version' | 'contributions'>,
  settingsStore: PluginSettingsStore,
): Promise<DesktopPluginV2SettingsSnapshot> {
  const settings = await Promise.all((manifest.contributions.settings ?? []).map(async declaration => ({
    ...declaration,
    value: await readExternalPluginV2SettingValue(manifest.id, declaration, settingsStore),
  } satisfies DesktopPluginV2SettingSnapshot)));
  return { pluginId: manifest.id, version: manifest.version, settings };
}

/** 保存宿主设置页提交的值；插件进程没有调用此函数的权限。 */
export async function writeExternalPluginV2Setting(
  manifest: Pick<ExternalPluginV2Manifest, 'id' | 'version' | 'contributions'>,
  settingId: string,
  value: ExternalPluginV2SettingValue,
  settingsStore: PluginSettingsStore,
): Promise<DesktopPluginV2SettingsSnapshot> {
  const declaration = manifest.contributions.settings?.find(setting => setting.id === settingId);
  if (!declaration || !isValidDeclaredValue(declaration, value)) {
    throw new Error('The v2 plugin setting value is invalid.');
  }
  await settingsStore.write(manifest.id, getSettingKey(settingId, manifest.id), value);
  return readExternalPluginV2Settings(manifest, settingsStore);
}

async function readExternalPluginV2SettingValue(
  pluginId: string,
  declaration: ExternalPluginV2SettingDeclaration,
  settingsStore: PluginSettingsStore,
): Promise<ExternalPluginV2SettingValue> {
  const stored = await readStoredSetting(settingsStore, pluginId, getSettingKey(declaration.id, pluginId));
  return isValidStoredValue(declaration, stored) ? stored : declaration.defaultValue;
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

function isValidDeclaredValue(
  declaration: ExternalPluginV2SettingDeclaration,
  value: ExternalPluginV2SettingValue,
): boolean {
  return isValidStoredValue(declaration, value);
}
