<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NFormItem, NInput, NInputNumber, NSpin, NSwitch, NTag, NText } from 'naive-ui';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { createQueuedRefresh } from '@/tools/queued-refresh';
import { externalPluginV2SupportedCapabilities } from '@/shared/external-plugin-v2';

type PluginManagerBridge = Required<Pick<NonNullable<Window['itToolsDesktop']>,
  | 'listPluginV2Packages'
  | 'listTrustedPluginSigners'
  | 'previewPluginSigner'
  | 'trustPluginSigner'
  | 'revokePluginSigner'
>> & Pick<NonNullable<Window['itToolsDesktop']>,
  | 'listPluginV2Settings'
  | 'updatePluginV2Setting'
  | 'installPluginV2Package'
  | 'activatePluginV2Package'
  | 'setPluginV2PackageEnabled'
  | 'uninstallPluginV2Package'
>;

const { locale } = useI18n();
const language = computed(() => locale.value === 'zh' ? 'zh' : 'en');
const isLoading = ref(true);
const isBusy = ref(false);
const v2Packages = ref<DesktopPluginV2Snapshot[]>([]);
const v2Settings = reactive<Record<string, DesktopPluginV2SettingsSnapshot | undefined>>({});
const v2SettingDrafts = reactive<Record<string, string | number | boolean>>({});
const signers = ref<DesktopPluginSignerSnapshot[]>([]);
const pluginError = ref<string>();
const trustStoreError = ref<string>();
const notice = ref<string>();
const signerForm = reactive({ keyId: '', pluginIds: '', publicKey: '' });
const signerPreview = ref<DesktopPluginSignerSnapshot>();
type V2PluginAction = 'install' | 'uninstall' | 'activate' | 'enabled';
const v2PluginAction = ref<{ key?: string; action: V2PluginAction }>();
const v2SettingAction = ref<{ key: string; settingId: string }>();

const messages = {
  en: {
    title: 'Desktop plugin packages',
    intro: 'Install signed v2 packages. Their tools use the same navigation, search, and workspace UI as built-in tools.',
    webOnly: 'External plugin packages are available only in the desktop app. The web version continues to use built-in and first-party extensions.',
    refresh: 'Refresh',
    browseMarketplace: 'Browse plugin marketplace',
    v2Title: 'Host-rendered plugin packages',
    v2Intro: 'These packages contribute commands, fields, results, and approved capabilities. The host renders every tool page.',
    v2Install: 'Install v2 package',
    v2InstallInProgress: 'Installing v2 package…',
    v2Empty: 'No v2 plugin packages are installed.',
    v2ExecutionPending: 'WASM tools can request runtime information, declared settings, or host OUI data with your approval for each run.',
    v2Uninstall: 'Uninstall package',
    v2UninstallInProgress: 'Uninstalling v2 package…',
    v2Activate: 'Use this version',
    v2ActivateInProgress: 'Switching active version…',
    v2Enable: 'Enable package',
    v2Disable: 'Disable package',
    v2EnableInProgress: 'Updating package state…',
    v2Active: 'Active version',
    v2Inactive: 'Installed version',
    v2Enabled: 'Enabled',
    v2Disabled: 'Disabled',
    v2Activated: 'Active plugin version changed.',
    v2EnabledNotice: 'Plugin package enabled.',
    v2DisabledNotice: 'Plugin package disabled.',
    v2Installed: 'Signed v2 package installed. Supported tools can appear in navigation and search.',
    v2Uninstalled: 'V2 package removed.',
    v2Tools: 'Declared tools',
    v2Capabilities: 'Requested capabilities',
    v2CapabilityRuntimeInfo: 'Runtime information · approval required for each command',
    v2CapabilitySettingsRead: 'Declared settings · approval required for each command',
    v2CapabilityDataOui: 'Host OUI data · approval required for each command',
    v2CapabilityUnsupported: 'Not currently supported by this host',
    v2PermissionNotice: 'Installing a v2 package does not grant capabilities. The host asks for approval when a command uses them.',
    v2Settings: 'Host settings',
    v2SettingsIntro: 'Edit non-secret settings in the host. A tool receives only the settings it declares when you run it.',
    v2SaveSetting: 'Save setting',
    v2SettingSaved: 'Plugin setting saved.',
    v2SettingsUnavailable: 'The plugin settings store is unavailable. The host did not change the setting.',
    v2Runtime: 'Runtime',
    v2Invalid: 'Invalid package',
    v2StatusInstalled: 'Installed',
    loading: 'Loading plugin packages…',
    diagnostics: 'Diagnostics',
    packageId: 'Package ID',
    packageVersion: 'Package version',
    errorCode: 'Error code',
    operationFailed: 'The operation could not be completed.',
    dataProviderFailed: 'The host data provider request could not be completed.',
    signerTitle: 'Trusted plugin signers',
    signerIntro: 'Trust only public keys whose fingerprints you verified with the publisher. A valid signature confirms package origin and integrity, not code safety.',
    noSigners: 'No signer keys are trusted. Add a publisher key before installing its packages.',
    keyId: 'Signer key ID',
    pluginIds: 'Allowed plugin IDs, separated by commas',
    publicKey: 'Ed25519 public key (PEM)',
    preview: 'Preview fingerprint',
    fingerprint: 'Fingerprint to verify with the publisher',
    trust: 'Trust this signer',
    revoke: 'Revoke signer',
    signerAdded: 'Signer key added.',
    signerRemoved: 'Signer revoked.',
    invalidKey: 'The signer key, fingerprint confirmation, or plugin ID list is invalid.',
    operationCancelled: 'Operation cancelled.',
  },
  zh: {
    title: '桌面插件包',
    intro: '安装已签名的 v2 插件包。插件工具使用与内置工具相同的导航、搜索和工作区界面。',
    webOnly: '外部插件包只支持桌面应用。Web 版本继续使用内置和第一方扩展。',
    refresh: '刷新',
    browseMarketplace: '浏览插件市场',
    v2Title: '宿主渲染插件包',
    v2Intro: '这些插件贡献命令、字段、结果和经批准的能力。宿主统一渲染每个工具页面。',
    v2Install: '安装 v2 插件包',
    v2InstallInProgress: '正在安装 v2 插件包…',
    v2Empty: '尚未安装 v2 插件包。',
    v2ExecutionPending: 'WASM 工具每次运行时可请求运行时信息、声明的设置或宿主 OUI 数据，并需要取得确认。',
    v2Uninstall: '卸载插件包',
    v2UninstallInProgress: '正在卸载 v2 插件包…',
    v2Activate: '使用此版本',
    v2ActivateInProgress: '正在切换活动版本…',
    v2Enable: '启用插件包',
    v2Disable: '停用插件包',
    v2EnableInProgress: '正在更新插件状态…',
    v2Active: '活动版本',
    v2Inactive: '已安装版本',
    v2Enabled: '已启用',
    v2Disabled: '已停用',
    v2Activated: '已切换活动插件版本。',
    v2EnabledNotice: '插件包已启用。',
    v2DisabledNotice: '插件包已停用。',
    v2Installed: '已安装签名 v2 插件包。受支持的工具可以显示在导航和搜索中。',
    v2Uninstalled: '已卸载 v2 插件包。',
    v2Tools: '声明的工具',
    v2Capabilities: '请求的能力',
    v2CapabilityRuntimeInfo: '运行时信息 · 每条命令都需要确认',
    v2CapabilitySettingsRead: '声明的设置 · 每条命令都需要确认',
    v2CapabilityDataOui: '宿主 OUI 数据 · 每条命令都需要确认',
    v2CapabilityUnsupported: '当前宿主暂不支持',
    v2PermissionNotice: '安装 v2 插件包不会自动授予能力。命令使用能力时，宿主会单独请求确认。',
    v2Settings: '宿主设置',
    v2SettingsIntro: '在宿主中编辑非秘密设置。工具运行时只会收到它声明读取的设置。',
    v2SaveSetting: '保存设置',
    v2SettingSaved: '插件设置已保存。',
    v2SettingsUnavailable: '插件设置存储不可用。宿主没有修改设置。',
    v2Runtime: '运行时',
    v2Invalid: '插件包无效',
    v2StatusInstalled: '已安装',
    loading: '正在加载插件包…',
    diagnostics: '诊断信息',
    packageId: '插件包 ID',
    packageVersion: '插件包版本',
    errorCode: '错误码',
    operationFailed: '无法完成此操作。',
    dataProviderFailed: '无法完成宿主数据提供者请求。',
    signerTitle: '受信任的插件签名者',
    signerIntro: '只信任你已向发布者核对指纹的公钥。有效签名可以确认包的来源和完整性，但不能证明代码安全。',
    noSigners: '尚未信任签名者。安装插件前，请先添加发布者公钥。',
    keyId: '签名者密钥 ID',
    pluginIds: '允许签名的插件 ID，使用逗号分隔',
    publicKey: 'Ed25519 公钥（PEM）',
    preview: '查看指纹',
    fingerprint: '请向发布者核对此指纹',
    trust: '信任此签名者',
    revoke: '撤销签名者',
    signerAdded: '已添加签名者公钥。',
    signerRemoved: '已撤销签名者。',
    invalidKey: '签名密钥、指纹确认或插件 ID 列表无效。',
    operationCancelled: '操作已取消。',
  },
} as const;

const activeMessages = computed(() => messages[language.value]);
const text = (key: keyof typeof messages.en) => activeMessages.value[key];

function getPluginBridge(): PluginManagerBridge | undefined {
  const bridge = window.itToolsDesktop;
  if (!bridge?.listPluginV2Packages || !bridge.listTrustedPluginSigners || !bridge.previewPluginSigner || !bridge.trustPluginSigner || !bridge.revokePluginSigner) {return undefined;}
  return bridge as PluginManagerBridge;
}

const isDesktop = computed(() => typeof window !== 'undefined' && Boolean(getPluginBridge()));

function v2PackageKey(plugin: DesktopPluginV2Snapshot): string { return `${plugin.pluginId}:${plugin.version}`; }
function v2SettingKey(plugin: DesktopPluginV2Snapshot, settingId: string): string { return `${v2PackageKey(plugin)}:${settingId}`; }

/** 从主进程快照读取设置值，保证编辑控件不直接接触持久化文件。 */
function v2SettingsFor(plugin: DesktopPluginV2Snapshot): readonly DesktopPluginV2SettingSnapshot[] { return v2Settings[v2PackageKey(plugin)]?.settings ?? []; }
function v2SettingDraftValue(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): string | number | boolean { return v2SettingDrafts[v2SettingKey(plugin, setting.id)] ?? setting.value; }
function v2StringSettingValue(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): string { const value = v2SettingDraftValue(plugin, setting); return typeof value === 'string' ? value : ''; }
function v2NumberSettingValue(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): number { const value = v2SettingDraftValue(plugin, setting); return typeof value === 'number' ? value : 0; }
function v2BooleanSettingValue(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): boolean { return v2SettingDraftValue(plugin, setting) === true; }
function updateV2SettingDraft(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot, value: string | number | boolean | null): void { v2SettingDrafts[v2SettingKey(plugin, setting.id)] = value === null ? setting.value : value; }
function isV2SettingSaving(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): boolean { const action = v2SettingAction.value; return action?.key === v2PackageKey(plugin) && action.settingId === setting.id; }
function isV2SettingDirty(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): boolean { return !Object.is(v2SettingDraftValue(plugin, setting), setting.value); }

/** 刷新包列表后同步每个已安装 v2 包的宿主设置快照。 */
function applyV2Settings(snapshot: DesktopPluginV2SettingsSnapshot): void {
  const key = `${snapshot.pluginId}:${snapshot.version}`;
  v2Settings[key] = snapshot;
  for (const setting of snapshot.settings) {v2SettingDrafts[`${key}:${setting.id}`] = setting.value;}
}

function isV2PluginAction(plugin: DesktopPluginV2Snapshot, action: V2PluginAction): boolean { return v2PluginAction.value?.action === action && v2PluginAction.value.key === v2PackageKey(plugin); }
function isV2CapabilitySupported(capability: string): boolean { return externalPluginV2SupportedCapabilities.some(item => item === capability); }
function v2CapabilityLabel(capability: string): string {
  if (capability === 'runtime.info') {return text('v2CapabilityRuntimeInfo');}
  if (capability === 'settings.read') {return text('v2CapabilitySettingsRead');}
  if (capability === 'data.oui') {return text('v2CapabilityDataOui');}
  return text('v2CapabilityUnsupported');
}
function displayPluginError(error: string): string {
  if (error.startsWith('data-')) {return text('dataProviderFailed');}
  if (error === 'store-unavailable' || error === 'invalid-store') {return text('v2SettingsUnavailable');}
  if (error === 'invalid-key' || error === 'trust-confirmation-required') {return text('invalidKey');}
  if (error === 'cancelled') {return text('operationCancelled');}
  return text('operationFailed');
}

async function refreshV2Settings(bridge: PluginManagerBridge, packages: readonly DesktopPluginV2Snapshot[]): Promise<void> {
  for (const key of Object.keys(v2Settings)) {delete v2Settings[key];}
  for (const key of Object.keys(v2SettingDrafts)) {delete v2SettingDrafts[key];}
  if (!bridge.listPluginV2Settings) {return;}
  const candidates = packages.filter(plugin => plugin.status === 'installed' && (plugin.manifest.contributions.settings?.length ?? 0) > 0);
  const results = await Promise.all(candidates.map(async plugin => {
    try { return await bridge.listPluginV2Settings!({ pluginId: plugin.pluginId, version: plugin.version }); }
    catch { return { ok: false as const, error: 'operation-failed' as const }; }
  }));
  for (const result of results) {
    if (result.ok) {applyV2Settings(result.value);}
    else {pluginError.value = displayPluginError(result.error);}
  }
}

const refresh = createQueuedRefresh(async () => {
  const bridge = getPluginBridge();
  if (!bridge) { isLoading.value = false; return; }
  isLoading.value = true;
  pluginError.value = undefined;
  trustStoreError.value = undefined;
  try {
    const [v2Result, signerResult] = await Promise.all([bridge.listPluginV2Packages(), bridge.listTrustedPluginSigners()]);
    v2Packages.value = v2Result.ok ? v2Result.value : [];
    signers.value = signerResult.ok ? signerResult.value : [];
    if (!v2Result.ok) {pluginError.value = displayPluginError(v2Result.error);}
    if (!signerResult.ok) {trustStoreError.value = displayPluginError(signerResult.error);}
    if (v2Result.ok) {await refreshV2Settings(bridge, v2Result.value);}
  }
  catch { pluginError.value = text('operationFailed'); }
  finally { isLoading.value = false; }
});

async function installV2Plugin(): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge?.installPluginV2Package) {return;}
  v2PluginAction.value = { action: 'install' };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.installPluginV2Package();
    if (!result.ok) {pluginError.value = displayPluginError(result.error);}
    else if (result.value) { notice.value = text('v2Installed'); await refresh(); }
  }
  catch { pluginError.value = text('operationFailed'); }
  finally { v2PluginAction.value = undefined; isBusy.value = false; }
}

async function uninstallV2Plugin(plugin: DesktopPluginV2Snapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge?.uninstallPluginV2Package) {return;}
  v2PluginAction.value = { key: v2PackageKey(plugin), action: 'uninstall' };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.uninstallPluginV2Package(plugin.pluginId, plugin.version);
    if (!result.ok) {pluginError.value = displayPluginError(result.error);}
    else if (result.value) { notice.value = text('v2Uninstalled'); await refresh(); }
  }
  catch { pluginError.value = text('operationFailed'); }
  finally { v2PluginAction.value = undefined; isBusy.value = false; }
}

async function activateV2Plugin(plugin: DesktopPluginV2Snapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge?.activatePluginV2Package || plugin.active) {return;}
  v2PluginAction.value = { key: v2PackageKey(plugin), action: 'activate' };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.activatePluginV2Package(plugin.pluginId, plugin.version);
    if (!result.ok) {pluginError.value = displayPluginError(result.error);}
    else {notice.value = text('v2Activated'); await refresh();}
  }
  catch { pluginError.value = text('operationFailed'); }
  finally { v2PluginAction.value = undefined; isBusy.value = false; }
}

async function toggleV2Plugin(plugin: DesktopPluginV2Snapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge?.setPluginV2PackageEnabled) {return;}
  v2PluginAction.value = { key: v2PackageKey(plugin), action: 'enabled' };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.setPluginV2PackageEnabled(plugin.pluginId, plugin.version, !plugin.enabled);
    if (!result.ok) {pluginError.value = displayPluginError(result.error);}
    else {notice.value = text(plugin.enabled ? 'v2DisabledNotice' : 'v2EnabledNotice'); await refresh();}
  }
  catch { pluginError.value = text('operationFailed'); }
  finally { v2PluginAction.value = undefined; isBusy.value = false; }
}

/** 将用户编辑的单个设置交给主进程校验并原子保存。 */
async function saveV2Setting(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  const value = v2SettingDraftValue(plugin, setting);
  if (!bridge?.updatePluginV2Setting || !isV2SettingDirty(plugin, setting)) {return;}
  v2SettingAction.value = { key: v2PackageKey(plugin), settingId: setting.id };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.updatePluginV2Setting({ pluginId: plugin.pluginId, version: plugin.version, settingId: setting.id, value });
    if (!result.ok) {pluginError.value = displayPluginError(result.error);}
    else { applyV2Settings(result.value); notice.value = text('v2SettingSaved'); }
  }
  catch { pluginError.value = text('v2SettingsUnavailable'); }
  finally { v2SettingAction.value = undefined; isBusy.value = false; }
}

function signerInput(): DesktopPluginSignerInput {
  return { keyId: signerForm.keyId.trim(), publicKey: signerForm.publicKey.trim(), allowedPluginIds: signerForm.pluginIds.split(/[\s,]+/).map(value => value.trim()).filter(Boolean) };
}
async function previewSigner(): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {return;}
  isBusy.value = true;
  trustStoreError.value = undefined;
  signerPreview.value = undefined;
  try {
    const result = await bridge.previewPluginSigner(signerInput());
    if (!result.ok) {trustStoreError.value = displayPluginError(result.error);}
    else {signerPreview.value = result.value;}
  }
  catch { trustStoreError.value = text('invalidKey'); }
  finally { isBusy.value = false; }
}
async function trustSigner(): Promise<void> {
  const bridge = getPluginBridge();
  const preview = signerPreview.value;
  if (!bridge || !preview) {return;}
  isBusy.value = true;
  trustStoreError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.trustPluginSigner(signerInput(), preview.fingerprint);
    if (!result.ok) {trustStoreError.value = displayPluginError(result.error);}
    else if (result.value) {
      signerForm.keyId = '';
      signerForm.pluginIds = '';
      signerForm.publicKey = '';
      signerPreview.value = undefined;
      notice.value = text('signerAdded');
      await refresh();
    }
  }
  catch { trustStoreError.value = text('operationFailed'); }
  finally { isBusy.value = false; }
}
async function revokeSigner(signer: DesktopPluginSignerSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {return;}
  isBusy.value = true;
  trustStoreError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.revokePluginSigner(signer.keyId);
    if (!result.ok) {trustStoreError.value = displayPluginError(result.error);}
    else if (result.value) { notice.value = text('signerRemoved'); await refresh(); }
  }
  catch { trustStoreError.value = text('operationFailed'); }
  finally { isBusy.value = false; }
}

watch(signerForm, () => { signerPreview.value = undefined; }, { deep: true });
let disposePluginStateChange: (() => void) | undefined;
onMounted(() => {
  disposePluginStateChange = window.itToolsDesktop?.onPluginStateChanged?.(() => { if (!isBusy.value) {void refresh();} });
  void refresh();
});
onUnmounted(() => disposePluginStateChange?.());
</script>

<template>
  <section class="electron-plugin-manager" aria-labelledby="electron-plugin-manager-title" :aria-busy="isLoading">
    <div class="plugin-section-heading">
      <div><h2 id="electron-plugin-manager-title">{{ text('title') }}</h2><p>{{ text('intro') }}</p></div>
      <div class="plugin-section-actions">
        <n-button v-if="isDesktop" class="plugin-install-action" type="primary" :disabled="isBusy || isLoading" :loading="v2PluginAction?.action === 'install'" @click="installV2Plugin">{{ v2PluginAction?.action === 'install' ? text('v2InstallInProgress') : text('v2Install') }}</n-button>
        <n-button tag="a" href="/plugin-marketplace" secondary>{{ text('browseMarketplace') }}</n-button>
        <n-button v-if="isDesktop" :disabled="isLoading || isBusy" @click="refresh">{{ text('refresh') }}</n-button>
      </div>
    </div>
    <n-alert v-if="!isDesktop" type="info" :show-icon="false" mb-4>{{ text('webOnly') }}</n-alert>
    <template v-else>
      <n-card v-if="!isLoading && v2Packages.length === 0 && signers.length === 0 && !trustStoreError" class="plugin-onboarding-card" data-test-id="plugin-manager-onboarding">
        <template #header>{{ text('v2Title') }}</template><p>{{ text('v2Intro') }}</p>
      </n-card>
      <n-alert v-if="pluginError" type="error" role="alert" mb-4>{{ pluginError }}</n-alert>
      <n-alert v-if="trustStoreError" type="error" role="alert" mb-4>{{ trustStoreError }}</n-alert>
      <n-alert v-if="notice" type="success" role="status" mb-4>{{ notice }}</n-alert>
      <n-spin :show="isLoading">
        <p v-if="isLoading" class="plugin-loading-status" role="status" aria-live="polite">{{ text('loading') }}</p>
        <n-empty v-if="!isLoading && v2Packages.length === 0" :description="text('v2Empty')" />
        <n-card v-else class="v2-plugin-package-card" :title="text('v2Title')">
          <div class="v2-plugin-section-heading"><p>{{ text('v2Intro') }}</p></div>
          <n-alert type="info" :show-icon="false" mb-4>{{ text('v2ExecutionPending') }}</n-alert>
          <div class="plugin-package-list">
            <n-card v-for="plugin in v2Packages" :key="v2PackageKey(plugin)" :title="plugin.name" class="plugin-package-card" :data-test-id="`plugin-v2-package-${plugin.pluginId}-${plugin.version}`">
              <div class="plugin-package-meta"><n-text>{{ plugin.pluginId }} · {{ plugin.version }}</n-text><div class="plugin-package-tags"><n-tag :type="plugin.status === 'installed' ? 'success' : 'error'">{{ plugin.status === 'installed' ? text('v2StatusInstalled') : text('v2Invalid') }}</n-tag><n-tag v-if="plugin.active" type="info">{{ text('v2Active') }}</n-tag><n-tag v-else type="default">{{ text('v2Inactive') }}</n-tag><n-tag :type="plugin.enabled ? 'success' : 'warning'">{{ plugin.enabled ? text('v2Enabled') : text('v2Disabled') }}</n-tag></div></div>
              <div class="plugin-diagnostics" :aria-label="text('diagnostics')"><span>{{ text('packageId') }}: <code>{{ plugin.pluginId }}</code></span><span>{{ text('packageVersion') }}: <code>{{ plugin.version }}</code></span><span>{{ text('v2Runtime') }}: <code>{{ plugin.runtime }}</code></span><span v-if="plugin.errorCode" class="plugin-error-code">{{ text('errorCode') }}: <code>{{ plugin.errorCode }}</code></span></div>
              <div v-if="plugin.manifest.requestedCapabilities.length > 0" class="plugin-capability-list">
                <n-text strong>{{ text('v2Capabilities') }}</n-text>
                <div v-for="capability in plugin.manifest.requestedCapabilities" :key="capability" class="plugin-capability-row"><div class="plugin-capability-control"><n-tag size="small" :type="isV2CapabilitySupported(capability) ? 'success' : 'warning'">{{ capability }}</n-tag><n-text depth="3">{{ v2CapabilityLabel(capability) }}</n-text></div></div>
                <n-alert type="info" :show-icon="false">{{ text('v2PermissionNotice') }}</n-alert>
              </div>
              <div v-if="plugin.manifest.contributions.tools.length > 0" class="plugin-contribution-list"><n-text strong>{{ text('v2Tools') }}</n-text><div v-for="tool in plugin.manifest.contributions.tools" :key="tool.id" class="plugin-contribution-row"><n-text strong>{{ tool.title }}</n-text><n-text depth="3">{{ tool.description }}</n-text></div></div>
              <div v-if="v2SettingsFor(plugin).length > 0" class="plugin-settings-list">
                <n-text strong>{{ text('v2Settings') }}</n-text><n-text depth="3">{{ text('v2SettingsIntro') }}</n-text>
                <div v-for="setting in v2SettingsFor(plugin)" :key="setting.id" class="plugin-setting-row">
                  <div class="plugin-setting-copy"><n-text strong>{{ setting.label }}</n-text><n-text depth="3">{{ setting.description }}</n-text><code>{{ setting.id }}</code></div>
                  <div class="plugin-setting-control">
                    <n-input v-if="setting.type === 'string'" :value="v2StringSettingValue(plugin, setting)" :maxlength="setting.maxLength" :aria-label="setting.label" @update:value="value => updateV2SettingDraft(plugin, setting, value)" />
                    <n-input-number v-else-if="setting.type === 'number'" :value="v2NumberSettingValue(plugin, setting)" :min="setting.minimum" :max="setting.maximum" :precision="setting.integer ? 0 : undefined" :aria-label="setting.label" @update:value="value => updateV2SettingDraft(plugin, setting, value)" />
                    <n-switch v-else :value="v2BooleanSettingValue(plugin, setting)" :aria-label="setting.label" @update:value="value => updateV2SettingDraft(plugin, setting, value)" />
                    <n-button size="small" type="primary" :disabled="isBusy || !isV2SettingDirty(plugin, setting)" :loading="isV2SettingSaving(plugin, setting)" @click="saveV2Setting(plugin, setting)">{{ text('v2SaveSetting') }}</n-button>
                  </div>
                </div>
              </div>
              <div class="plugin-package-actions"><div class="plugin-package-lifecycle-actions"><n-button v-if="!plugin.active" quaternary :disabled="isBusy || plugin.status !== 'installed'" :loading="isV2PluginAction(plugin, 'activate')" @click="activateV2Plugin(plugin)">{{ isV2PluginAction(plugin, 'activate') ? text('v2ActivateInProgress') : text('v2Activate') }}</n-button><n-button v-if="plugin.active" quaternary :disabled="isBusy || plugin.status !== 'installed'" :loading="isV2PluginAction(plugin, 'enabled')" @click="toggleV2Plugin(plugin)">{{ isV2PluginAction(plugin, 'enabled') ? text('v2EnableInProgress') : plugin.enabled ? text('v2Disable') : text('v2Enable') }}</n-button></div><n-button quaternary :disabled="isBusy" :loading="isV2PluginAction(plugin, 'uninstall')" @click="uninstallV2Plugin(plugin)">{{ isV2PluginAction(plugin, 'uninstall') ? text('v2UninstallInProgress') : text('v2Uninstall') }}</n-button></div>
            </n-card>
          </div>
        </n-card>
      </n-spin>
      <n-card :title="text('signerTitle')" class="trusted-signer-card">
        <p>{{ text('signerIntro') }}</p>
        <n-alert v-if="signers.length === 0" type="info" :show-icon="false" mb-4>{{ text('noSigners') }}</n-alert>
        <div v-for="signer in signers" :key="signer.keyId" class="trusted-signer-row"><div><n-text strong>{{ signer.keyId }}</n-text><div><code>{{ signer.fingerprint }}</code></div><n-text depth="3">{{ signer.allowedPluginIds.join(', ') }}</n-text></div><n-button type="error" quaternary :disabled="isBusy" @click="revokeSigner(signer)">{{ text('revoke') }}</n-button></div>
        <div class="signer-form">
          <n-form-item label-for="plugin-signer-key-id" :label="text('keyId')" label-placement="top"><n-input v-model:value="signerForm.keyId" :input-props="{ id: 'plugin-signer-key-id', 'aria-label': text('keyId') }" maxlength="128" autocomplete="off" /></n-form-item>
          <n-form-item label-for="plugin-signer-plugin-ids" :label="text('pluginIds')" label-placement="top"><n-input v-model:value="signerForm.pluginIds" :input-props="{ id: 'plugin-signer-plugin-ids', 'aria-label': text('pluginIds') }" maxlength="4096" autocomplete="off" /></n-form-item>
          <n-form-item label-for="plugin-signer-public-key" :label="text('publicKey')" label-placement="top"><n-input v-model:value="signerForm.publicKey" :input-props="{ id: 'plugin-signer-public-key', 'aria-label': text('publicKey') }" type="textarea" :autosize="{ minRows: 4, maxRows: 8 }" autocomplete="off" /></n-form-item>
          <n-button :disabled="isBusy" @click="previewSigner">{{ text('preview') }}</n-button>
          <div v-if="signerPreview" class="signer-preview" role="status"><n-text>{{ text('fingerprint') }}</n-text><code>{{ signerPreview.fingerprint }}</code><n-button type="primary" :disabled="isBusy" @click="trustSigner">{{ text('trust') }}</n-button></div>
        </div>
      </n-card>
    </template>
  </section>
</template>

<style scoped>
.electron-plugin-manager { display: grid; gap: 16px; margin-top: 32px; }
.plugin-package-meta, .plugin-package-actions, .trusted-signer-row, .signer-preview { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.plugin-package-tags, .plugin-package-lifecycle-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.plugin-section-heading { display: grid; gap: 16px; min-width: 0; }
.plugin-section-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.v2-plugin-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.plugin-section-heading h2 { margin: 0 0 8px; font-size: 1.25rem; }
.plugin-section-heading p, .v2-plugin-section-heading p, .trusted-signer-card > p, .plugin-onboarding-card p { margin: 0; color: var(--n-text-color-3); }
.plugin-diagnostics { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; color: var(--n-text-color-3); font-size: 0.82rem; }
.plugin-diagnostics code { overflow-wrap: anywhere; }
.plugin-error-code { color: var(--n-error-color); }
.plugin-capability-list, .plugin-contribution-list, .plugin-settings-list { display: grid; gap: 8px; margin-top: 16px; }
.plugin-capability-row, .plugin-contribution-row { display: grid; gap: 4px; }
.plugin-capability-control { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.plugin-setting-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 1fr); gap: 16px; align-items: center; padding: 12px 0; border-top: 1px solid var(--n-divider-color); }
.plugin-setting-copy { display: grid; gap: 4px; min-width: 0; }
.plugin-setting-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
.plugin-setting-control > *:first-child { flex: 1; min-width: 0; }
.trusted-signer-row { align-items: flex-start; padding: 12px 0; border-bottom: 1px solid var(--n-divider-color); }
.signer-form { display: grid; gap: 12px; margin-top: 20px; }
.signer-preview { justify-content: flex-start; flex-wrap: wrap; }
@media (max-width: 560px) {
  .v2-plugin-section-heading { align-items: stretch; flex-direction: column; }
  .plugin-section-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .plugin-install-action { grid-column: 1 / -1; }
  .plugin-setting-row { grid-template-columns: 1fr; }
  .plugin-setting-control { align-items: stretch; flex-direction: column; }
}
</style>
