<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NFormItem, NInput, NInputNumber, NSpin, NSwitch, NText } from 'naive-ui';
import { useHead } from '@unhead/vue';
import ExtensionPluginManager from '@/components/ExtensionPluginManager.vue';
import type { ExtensionSettingSnapshot, ExtensionSettingValue, ExtensionSettingsPackageSnapshot } from '@/extensions';
import type { FirstPartyExtensionHost } from '@/extensions';
import { useStyleStore } from '@/stores/style.store';

const { locale } = useI18n();
const styleStore = useStyleStore();
const packages = ref<ExtensionSettingsPackageSnapshot[]>([]);
const host = shallowRef<FirstPartyExtensionHost>();
const isLoading = ref(true);
const loadFailed = ref(false);
const saving = reactive<Record<string, boolean>>({});
const saveFailed = reactive<Record<string, boolean>>({});
const saveSucceeded = reactive<Record<string, boolean>>({});
const draftValues = reactive<Record<string, ExtensionSettingValue>>({});

const language = computed(() => locale.value === 'zh' ? 'zh' : 'en');
const settingsMessages = {
  en: {
    title: 'Settings',
    intro: 'Manage application preferences, tool settings, and plugins.',
    generalTitle: 'General',
    languageLabel: 'Language',
    languageDescription: 'Choose the language used across the app.',
    themeLabel: 'Theme',
    darkTheme: 'Dark',
    lightTheme: 'Light',
    toolSettingsTitle: 'Tool settings',
    toolSettingsIntro: 'Manage preferences supplied by first-party tool packages.',
    loading: 'Loading extension settings…',
    loadError: 'Extension settings could not be loaded. Other tools remain available.',
    unavailable: 'This package settings page is unavailable. Other packages remain available.',
    storageInfo: 'Settings use this browser or desktop profile. If local storage is blocked, changes last only until the app closes.',
    saved: 'Setting saved.',
    saveError: 'The setting could not be saved.',
    save: 'Save',
    reset: 'Reset to default',
    empty: 'No first-party extension settings are available.',
    migrated: 'This saved value was upgraded to the current setting version.',
    migrationFailed: 'The saved value could not be migrated. The previous data was preserved and the default is in use.',
    newerVersion: 'This value was saved by a newer app version. The stored data was preserved and the default is in use.',
  },
  zh: {
    title: '设置',
    intro: '管理应用偏好、工具设置和插件。',
    generalTitle: '通用',
    languageLabel: '语言',
    languageDescription: '选择应用界面使用的语言。',
    themeLabel: '主题',
    darkTheme: '深色',
    lightTheme: '浅色',
    toolSettingsTitle: '工具设置',
    toolSettingsIntro: '管理第一方工具包提供的偏好设置。',
    loading: '正在加载扩展设置…',
    loadError: '无法加载扩展设置。其他工具仍可使用。',
    unavailable: '此工具包的设置暂不可用。其他工具包仍可使用。',
    storageInfo: '设置保存在当前浏览器或桌面应用配置中。如果本地存储不可用，更改只保留到应用关闭。',
    saved: '设置已保存。',
    saveError: '无法保存此设置。',
    save: '保存',
    reset: '恢复默认值',
    empty: '当前没有可用的第一方扩展设置。',
    migrated: '已将保存的值升级到当前设置版本。',
    migrationFailed: '无法迁移已保存的值。旧数据已保留，当前使用默认值。',
    newerVersion: '此值由较新的应用版本保存。原数据已保留，当前使用默认值。',
  },
} as const;
type SettingsMessageKey = keyof typeof settingsMessages.en;
const activeMessages = computed(() => settingsMessages[language.value]);
const text = (key: SettingsMessageKey) => activeMessages.value[key];

useHead({ title: computed(() => text('title')) });

function settingKey(setting: ExtensionSettingSnapshot): string {
  return `${setting.pluginId}:${setting.definition.id}`;
}

function settingLabel(setting: ExtensionSettingSnapshot): string {
  return presentation(setting)?.label ?? setting.definition.id;
}

function settingInputId(setting: ExtensionSettingSnapshot): string {
  return `extension-setting-${encodeURIComponent(setting.definition.id)}`;
}

function presentation(setting: ExtensionSettingSnapshot) {
  return setting.definition.presentation?.[language.value] ?? setting.definition.presentation?.en;
}

function migrationMessage(setting: ExtensionSettingSnapshot): string | undefined {
  if (setting.migrationStatus === 'migrated') {
    return text('migrated');
  }
  if (setting.migrationStatus === 'migration-failed') {
    return text('migrationFailed');
  }
  if (setting.migrationStatus === 'newer-version') {
    return text('newerVersion');
  }
  return undefined;
}

async function loadSettings(): Promise<void> {
  isLoading.value = true;
  loadFailed.value = false;
  try {
    const runtime = await import('@/extensions/runtime');
    host.value = runtime.extensionHost;
    packages.value = await runtime.extensionHost.getSettingsCatalog();
    for (const packageInfo of packages.value) {
      for (const setting of packageInfo.settings) {
        draftValues[settingKey(setting)] = setting.value;
      }
    }
  }
  catch {
    loadFailed.value = true;
  }
  finally {
    isLoading.value = false;
  }
}

async function saveSetting(setting: ExtensionSettingSnapshot, value: ExtensionSettingValue): Promise<void> {
  const key = settingKey(setting);
  const extensionHost = host.value;
  if (!extensionHost) {
    saveFailed[key] = true;
    return;
  }

  saving[key] = true;
  saveFailed[key] = false;
  saveSucceeded[key] = false;
  try {
    await extensionHost.setSetting(setting.pluginId, setting.definition.id, value);
    const saved = await extensionHost.getSettingState(setting.pluginId, setting.definition.id);
    Object.assign(setting, saved);
    draftValues[key] = saved.value;
    saveSucceeded[key] = true;
  }
  catch {
    saveFailed[key] = true;
  }
  finally {
    saving[key] = false;
  }
}

function onNumberChange(setting: ExtensionSettingSnapshot, value: number | null): void {
  if (value !== null) {
    draftValues[settingKey(setting)] = value;
  }
}

function onBooleanChange(setting: ExtensionSettingSnapshot, value: boolean): void {
  draftValues[settingKey(setting)] = value;
}

function onStringChange(setting: ExtensionSettingSnapshot, value: string): void {
  draftValues[settingKey(setting)] = value;
}

function resetSetting(setting: ExtensionSettingSnapshot): void {
  void saveSetting(setting, setting.definition.defaultValue);
}

function saveDraft(setting: ExtensionSettingSnapshot): void {
  const key = settingKey(setting);
  let value = draftValues[key] ?? setting.value;
  if (setting.definition.type === 'number') {
    const input = document.getElementById(settingInputId(setting)) as HTMLInputElement | null;
    const rawValue = input?.value.trim() ?? '';
    const parsedValue = Number(rawValue);
    if (rawValue.length === 0 || !Number.isFinite(parsedValue)) {
      saveFailed[key] = true;
      return;
    }
    value = parsedValue;
  }
  void saveSetting(setting, value);
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <div class="settings-page">
    <div class="page-heading">
      <h1>{{ text('title') }}</h1>
      <p>{{ text('intro') }}</p>
    </div>

    <n-card :title="text('generalTitle')" class="general-settings">
      <div class="preference-row">
        <div>
          <strong>{{ text('languageLabel') }}</strong>
          <p>{{ text('languageDescription') }}</p>
        </div>
        <locale-selector />
      </div>

      <div class="preference-row">
        <div>
          <strong>{{ text('themeLabel') }}</strong>
        </div>
        <n-switch
          :value="styleStore.isDarkTheme"
          :aria-label="text('themeLabel')"
          @update:value="styleStore.toggleDark"
        >
          <template #checked>
            {{ text('darkTheme') }}
          </template>
          <template #unchecked>
            {{ text('lightTheme') }}
          </template>
        </n-switch>
      </div>
    </n-card>

    <n-alert type="info" :show-icon="false" mb-4>
      {{ text('storageInfo') }}
    </n-alert>

    <div class="section-heading">
      <h2>{{ text('toolSettingsTitle') }}</h2>
      <p>{{ text('toolSettingsIntro') }}</p>
    </div>

    <n-alert v-if="loadFailed" type="error" mb-4>
      {{ text('loadError') }}
    </n-alert>

    <n-spin :show="isLoading">
      <n-empty v-if="!isLoading && !loadFailed && packages.length === 0" :description="text('empty')" />

      <div v-else class="package-list">
        <n-card
          v-for="packageInfo in packages"
          :key="packageInfo.pluginId"
          :title="packageInfo.name"
          class="package-card"
        >
          <n-alert v-if="packageInfo.unavailable" type="warning" mb-4>
            {{ text('unavailable') }}
          </n-alert>

          <div v-for="setting in packageInfo.settings" :key="setting.definition.id" class="setting-row">
            <n-form-item :label="settingLabel(setting)" :label-for="settingInputId(setting)" label-placement="top" :show-feedback="false">
              <n-input-number
                v-if="setting.definition.type === 'number'"
                :input-props="{ id: settingInputId(setting), 'aria-label': settingLabel(setting) }"
                :value="typeof draftValues[settingKey(setting)] === 'number' ? draftValues[settingKey(setting)] as number : null"
                :min="setting.definition.minimum"
                :max="setting.definition.maximum"
                :precision="setting.definition.integer ? 0 : undefined"
                :disabled="packageInfo.unavailable || saving[settingKey(setting)]"
                w-full
                @update:value="onNumberChange(setting, $event)"
              />
              <n-switch
                v-else-if="setting.definition.type === 'boolean'"
                :id="settingInputId(setting)"
                :value="draftValues[settingKey(setting)] === true"
                :disabled="packageInfo.unavailable || saving[settingKey(setting)]"
                :aria-label="settingLabel(setting)"
                @update:value="onBooleanChange(setting, $event)"
              />
              <n-input
                v-else
                :id="settingInputId(setting)"
                :value="typeof draftValues[settingKey(setting)] === 'string' ? draftValues[settingKey(setting)] as string : ''"
                :maxlength="setting.definition.maxLength"
                :disabled="packageInfo.unavailable || saving[settingKey(setting)]"
                :aria-label="settingLabel(setting)"
                @update:value="onStringChange(setting, $event)"
              />
            </n-form-item>

            <n-text v-if="presentation(setting)?.description" depth="3" class="setting-description">
              {{ presentation(setting)?.description }}
            </n-text>
            <n-alert v-if="migrationMessage(setting)" :type="setting.migrationStatus === 'migrated' ? 'success' : 'warning'" :show-icon="false" mt-2>
              {{ migrationMessage(setting) }}
            </n-alert>
            <n-text v-if="saveFailed[settingKey(setting)]" type="error" role="alert">
              {{ text('saveError') }}
            </n-text>
            <n-text v-else-if="saveSucceeded[settingKey(setting)]" type="success" role="status">
              {{ text('saved') }}
            </n-text>
            <div class="setting-actions">
              <n-button
                type="primary"
                size="small"
                :loading="saving[settingKey(setting)]"
                :disabled="packageInfo.unavailable || saving[settingKey(setting)]"
                @click="saveDraft(setting)"
              >
                {{ text('save') }}
              </n-button>
              <n-button
                quaternary
                size="small"
                :disabled="packageInfo.unavailable || saving[settingKey(setting)] || setting.value === setting.definition.defaultValue"
                @click="resetSetting(setting)"
              >
                {{ text('reset') }}
              </n-button>
            </div>
          </div>
        </n-card>
      </div>
    </n-spin>

    <ExtensionPluginManager />
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 760px;
  margin: 32px auto;
  padding: 0 20px 40px;
}

.page-heading {
  margin-bottom: 20px;
}

.page-heading h1 {
  margin: 0 0 8px;
  font-size: 1.5rem;
}

.page-heading p {
  margin: 0;
  color: var(--n-text-color-3);
}

.general-settings {
  margin-bottom: 16px;
}

.preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.preference-row + .preference-row {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--n-border-color);
}

.preference-row p {
  margin: 4px 0 0;
  color: var(--n-text-color-3);
}

.section-heading {
  margin: 24px 0 16px;
}

.section-heading h2 {
  margin: 0 0 8px;
  font-size: 1.2rem;
}

.section-heading p {
  margin: 0;
  color: var(--n-text-color-3);
}

.package-list {
  display: grid;
  gap: 16px;
}

.setting-row + .setting-row {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--n-border-color);
}

.setting-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.setting-description {
  display: block;
  margin-top: 6px;
}
</style>
