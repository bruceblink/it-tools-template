<script setup lang="ts">
import { NAlert, NButton, NCard, NCheckbox, NEmpty, NFormItem, NInput, NSpin, NTag, NText } from 'naive-ui';
import { createQueuedRefresh } from '@/tools/queued-refresh';

const { locale } = useI18n();
const language = computed(() => locale.value === 'zh' ? 'zh' : 'en');
type PluginManagerBridge = Required<Pick<NonNullable<Window['itToolsDesktop']>,
  | 'listPlugins'
  | 'installPluginPackage'
  | 'activatePlugin'
  | 'disablePlugin'
  | 'uninstallPlugin'
  | 'listTrustedPluginSigners'
  | 'previewPluginSigner'
  | 'trustPluginSigner'
  | 'revokePluginSigner'
>>;

const isDesktop = computed(() => typeof window !== 'undefined' && Boolean(getPluginBridge()));
const isLoading = ref(true);
const isBusy = ref(false);
const plugins = ref<DesktopPluginSnapshot[]>([]);
const signers = ref<DesktopPluginSignerSnapshot[]>([]);
const pluginError = ref<string>();
const trustStoreError = ref<string>();
const notice = ref<string>();
const grantDrafts = reactive<Record<string, DesktopPluginCapability[]>>({});
const signerForm = reactive({
  keyId: '',
  pluginIds: '',
  publicKey: '',
});
const signerPreview = ref<DesktopPluginSignerSnapshot>();

function getPluginBridge(): PluginManagerBridge | undefined {
  const bridge = window.itToolsDesktop;
  if (
    !bridge?.listPlugins
    || !bridge.installPluginPackage
    || !bridge.activatePlugin
    || !bridge.disablePlugin
    || !bridge.uninstallPlugin
    || !bridge.listTrustedPluginSigners
    || !bridge.previewPluginSigner
    || !bridge.trustPluginSigner
    || !bridge.revokePluginSigner
  ) {
    return undefined;
  }
  return bridge as PluginManagerBridge;
}

const capabilities = computed(() => language.value === 'zh'
  ? [
      { id: 'runtime.info' as const, label: '读取平台和应用版本' },
      { id: 'clipboard.write' as const, label: '写入系统剪贴板' },
      { id: 'settings.read' as const, label: '读取此插件的已保存设置' },
      { id: 'settings.write' as const, label: '保存此插件的设置' },
    ]
  : [
      { id: 'runtime.info' as const, label: 'Read platform and app version' },
      { id: 'clipboard.write' as const, label: 'Write to the system clipboard' },
      { id: 'settings.read' as const, label: 'Read this plugin\'s saved settings' },
      { id: 'settings.write' as const, label: 'Save this plugin\'s settings' },
    ]);

const messages = {
  en: {
    title: 'Electron plugin packages',
    intro: 'Install signed packages, review requested capabilities, and run each package in an isolated window.',
    webOnly: 'External plugin packages are available only in the Electron desktop app. The web version continues to use built-in and first-party extensions.',
    refresh: 'Refresh',
    install: 'Install signed package',
    loading: 'Loading plugin packages…',
    empty: 'No external plugin packages are installed.',
    installed: 'Installed',
    active: 'Running',
    invalid: 'Invalid or untrusted',
    tools: 'Contributed tools',
    requested: 'Requested capabilities',
    noCapabilities: 'This package requests no host capabilities.',
    unsupported: 'Not supported by this host',
    run: 'Run plugin',
    stop: 'Stop plugin',
    remove: 'Uninstall version',
    noGrant: 'A capability is used only after you select it and approve the desktop prompt.',
    pluginError: 'Plugin operation failed.',
    trustError: 'The signer trust store could not be loaded or updated.',
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
    signerAdded: 'Signer key added. Plugin capabilities still require separate approval.',
    pluginInstalled: 'Signed package installed. It is not running yet.',
    pluginStarted: 'Plugin window started.',
    pluginStopped: 'Plugin window stopped.',
    pluginRemoved: 'Installed version removed.',
    signerRemoved: 'Signer revoked. Its active plugin windows were stopped.',
    permissionDenied: 'The plugin requested capabilities that are not supported by this host.',
    untrustedSignature: 'No trusted signer is configured for this package ID and key.',
    fileHashMismatch: 'An installed package file changed. The package was not started.',
    activationFailed: 'The package did not start. The previous version remains available.',
    rollbackFailed: 'The new version failed and the previous version could not be restored. The plugin is stopped.',
    activeLimit: 'The maximum number of plugin windows is already running.',
    rendererCrashed: 'The plugin renderer stopped unexpectedly. Run the package again to recover.',
    rendererUnresponsive: 'The plugin stopped responding and was closed. Run the package again to recover.',
    windowClosed: 'The plugin window closed unexpectedly. Run the package again to recover.',
    trustUnavailable: 'The trust store is unavailable. The app did not replace or clear its contents.',
    invalidKey: 'The signer key, fingerprint confirmation, or plugin ID list is invalid.',
    operationCancelled: 'Operation cancelled.',
    operationFailed: 'The operation could not be completed.',
  },
  zh: {
    title: 'Electron 插件包',
    intro: '安装已签名的插件包，检查能力请求，并在隔离窗口中运行插件。',
    webOnly: '外部插件包只支持 Electron 桌面应用。Web 版本继续使用内置和第一方扩展。',
    refresh: '刷新',
    install: '安装已签名的插件包',
    loading: '正在加载插件包…',
    empty: '尚未安装外部插件包。',
    installed: '已安装',
    active: '正在运行',
    invalid: '无效或不受信任',
    tools: '贡献的工具',
    requested: '请求的能力',
    noCapabilities: '此插件包没有请求宿主能力。',
    unsupported: '此宿主尚不支持',
    run: '运行插件',
    stop: '停止插件',
    remove: '卸载此版本',
    noGrant: '只有在你选中能力并确认桌面提示后，插件才能使用该能力。',
    pluginError: '插件操作失败。',
    trustError: '无法读取或更新签名者信任存储。',
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
    signerAdded: '已添加签名者公钥。插件仍需单独取得能力授权。',
    pluginInstalled: '已安装已签名的插件包。插件尚未运行。',
    pluginStarted: '插件窗口已启动。',
    pluginStopped: '插件窗口已停止。',
    pluginRemoved: '已删除此插件版本。',
    signerRemoved: '已撤销签名者。该密钥签名的运行中插件已停止。',
    permissionDenied: '插件请求了此宿主尚不支持的能力。',
    untrustedSignature: '此包的插件 ID 和密钥没有受信任的签名者。',
    fileHashMismatch: '已安装的包文件发生变化。宿主没有启动该包。',
    activationFailed: '插件包启动失败。旧版本仍可用。',
    rollbackFailed: '新版本启动失败，旧版本也无法恢复。插件当前已停止。',
    activeLimit: '当前运行的插件窗口已达到上限。',
    rendererCrashed: '插件渲染进程意外停止。可以重新运行插件包来恢复。',
    rendererUnresponsive: '插件无响应，宿主已关闭窗口。可以重新运行插件包来恢复。',
    windowClosed: '插件窗口意外关闭。可以重新运行插件包来恢复。',
    trustUnavailable: '信任存储不可用。应用没有替换或清空其中的数据。',
    invalidKey: '签名密钥、指纹确认或插件 ID 列表无效。',
    operationCancelled: '操作已取消。',
    operationFailed: '无法完成此操作。',
  },
} as const;

const activeMessages = computed(() => messages[language.value]);
const text = (key: keyof typeof messages.en) => activeMessages.value[key];

function packageKey(plugin: DesktopPluginSnapshot): string {
  return `${plugin.pluginId}:${plugin.version}`;
}

function packageStatus(plugin: DesktopPluginSnapshot): string {
  if (plugin.status === 'active') {
    return text('active');
  }
  if (plugin.status === 'invalid') {
    return text('invalid');
  }
  return text('installed');
}

function hasGrant(plugin: DesktopPluginSnapshot, capability: DesktopPluginCapability): boolean {
  const selected = grantDrafts[packageKey(plugin)];
  return selected?.includes(capability) ?? plugin.grantedCapabilities.includes(capability);
}

function isCapabilitySupported(plugin: DesktopPluginSnapshot, capability: string): capability is DesktopPluginCapability {
  return plugin.supportedCapabilities.includes(capability as DesktopPluginCapability);
}

function updateGrant(plugin: DesktopPluginSnapshot, capability: DesktopPluginCapability, checked: boolean): void {
  const key = packageKey(plugin);
  const selected = grantDrafts[key] ?? [...plugin.grantedCapabilities];
  grantDrafts[key] = checked
    ? [...new Set([...selected, capability])]
    : selected.filter(item => item !== capability);
}

function displayPluginError(error: string): string {
  if (error === 'untrusted-signature') {
    return text('untrustedSignature');
  }
  if (error === 'file-hash-mismatch') {
    return text('fileHashMismatch');
  }
  if (error === 'activation-failed') {
    return text('activationFailed');
  }
  if (error === 'activation-rollback-failed') {
    return text('rollbackFailed');
  }
  if (error === 'unsupported-capability') {
    return text('permissionDenied');
  }
  if (error === 'active-limit') {
    return text('activeLimit');
  }
  if (error === 'renderer-crashed') {
    return text('rendererCrashed');
  }
  if (error === 'renderer-unresponsive') {
    return text('rendererUnresponsive');
  }
  if (error === 'window-closed') {
    return text('windowClosed');
  }
  if (error === 'store-unavailable' || error === 'invalid-store') {
    return text('trustUnavailable');
  }
  if (error === 'invalid-key' || error === 'trust-confirmation-required') {
    return text('invalidKey');
  }
  if (error === 'cancelled') {
    return text('operationCancelled');
  }
  return `${text('operationFailed')} (${error})`;
}

const refresh = createQueuedRefresh(async () => {
  const bridge = getPluginBridge();
  if (!bridge) {
    isLoading.value = false;
    return;
  }
  isLoading.value = true;
  pluginError.value = undefined;
  trustStoreError.value = undefined;
  try {
    const [pluginResult, signerResult] = await Promise.all([
      bridge.listPlugins(),
      bridge.listTrustedPluginSigners(),
    ]);
    if (pluginResult.ok) {
      plugins.value = pluginResult.value;
      for (const plugin of pluginResult.value) {
        const key = packageKey(plugin);
        if (plugin.status === 'active') {
          grantDrafts[key] = [...plugin.grantedCapabilities];
        }
        else if (plugin.status === 'invalid') {
          grantDrafts[key] = [];
        }
        else {
          grantDrafts[key] ??= [...plugin.grantedCapabilities];
        }
      }
    }
    else {
      pluginError.value = displayPluginError(pluginResult.error);
    }
    if (signerResult.ok) {
      signers.value = signerResult.value;
    }
    else {
      trustStoreError.value = displayPluginError(signerResult.error);
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    isLoading.value = false;
  }
});

async function installPlugin(): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.installPluginPackage();
    if (!result.ok) {
      pluginError.value = displayPluginError(result.error);
    }
    else if (result.value) {
      notice.value = text('pluginInstalled');
      await refresh();
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

async function activatePlugin(plugin: DesktopPluginSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const grants = [...(grantDrafts[packageKey(plugin)] ?? [])];
    const result = await bridge.activatePlugin(plugin.pluginId, plugin.version, grants);
    if (!result.ok) {
      pluginError.value = displayPluginError(result.error);
    }
    else if (result.value) {
      notice.value = text('pluginStarted');
      await refresh();
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

async function disablePlugin(plugin: DesktopPluginSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.disablePlugin(plugin.pluginId);
    if (!result.ok) {
      pluginError.value = displayPluginError(result.error);
    }
    else {
      notice.value = text('pluginStopped');
      await refresh();
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

async function uninstallPlugin(plugin: DesktopPluginSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.uninstallPlugin(plugin.pluginId, plugin.version);
    if (!result.ok) {
      pluginError.value = displayPluginError(result.error);
    }
    else if (result.value) {
      notice.value = text('pluginRemoved');
      delete grantDrafts[packageKey(plugin)];
      await refresh();
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

function signerInput(): DesktopPluginSignerInput {
  return {
    keyId: signerForm.keyId.trim(),
    publicKey: signerForm.publicKey.trim(),
    allowedPluginIds: signerForm.pluginIds.split(/[\s,]+/).map(value => value.trim()).filter(Boolean),
  };
}

async function previewSigner(): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  isBusy.value = true;
  trustStoreError.value = undefined;
  signerPreview.value = undefined;
  try {
    const result = await bridge.previewPluginSigner(signerInput());
    if (!result.ok) {
      trustStoreError.value = displayPluginError(result.error);
    }
    else {
      signerPreview.value = result.value;
    }
  }
  catch {
    trustStoreError.value = text('invalidKey');
  }
  finally {
    isBusy.value = false;
  }
}

async function trustSigner(): Promise<void> {
  const bridge = getPluginBridge();
  const preview = signerPreview.value;
  if (!bridge || !preview) {
    return;
  }
  isBusy.value = true;
  trustStoreError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.trustPluginSigner(signerInput(), preview.fingerprint);
    if (!result.ok) {
      trustStoreError.value = displayPluginError(result.error);
    }
    else if (result.value) {
      signerForm.keyId = '';
      signerForm.pluginIds = '';
      signerForm.publicKey = '';
      signerPreview.value = undefined;
      notice.value = text('signerAdded');
      await refresh();
    }
  }
  catch {
    trustStoreError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

async function revokeSigner(signer: DesktopPluginSignerSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  isBusy.value = true;
  trustStoreError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.revokePluginSigner(signer.keyId);
    if (!result.ok) {
      trustStoreError.value = displayPluginError(result.error);
    }
    else if (result.value) {
      notice.value = text('signerRemoved');
      await refresh();
    }
  }
  catch {
    trustStoreError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

watch(signerForm, () => {
  signerPreview.value = undefined;
}, { deep: true });

let disposePluginStateChange: (() => void) | undefined;

onMounted(() => {
  disposePluginStateChange = window.itToolsDesktop?.onPluginStateChanged?.(() => {
    if (!isBusy.value) {
      void refresh();
    }
  });
  void refresh();
});

onUnmounted(() => {
  disposePluginStateChange?.();
});
</script>

<template>
  <section
    class="electron-plugin-manager"
    aria-labelledby="electron-plugin-manager-title"
    :aria-busy="isLoading"
  >
    <div class="plugin-section-heading">
      <div>
        <h2 id="electron-plugin-manager-title">{{ text('title') }}</h2>
        <p>{{ text('intro') }}</p>
      </div>
      <n-space>
        <n-button v-if="isDesktop" :disabled="isLoading || isBusy" @click="refresh">
          {{ text('refresh') }}
        </n-button>
        <n-button v-if="isDesktop" type="primary" :disabled="isBusy" @click="installPlugin">
          {{ text('install') }}
        </n-button>
      </n-space>
    </div>

    <n-alert v-if="!isDesktop" type="info" :show-icon="false" mb-4>
      {{ text('webOnly') }}
    </n-alert>

    <template v-else>
      <n-alert v-if="pluginError" type="error" role="alert" mb-4>
        {{ pluginError }}
      </n-alert>
      <n-alert v-if="trustStoreError" type="error" role="alert" mb-4>
        {{ trustStoreError }}
      </n-alert>
      <n-alert v-if="notice" type="success" role="status" mb-4>
        {{ notice }}
      </n-alert>

      <n-spin :show="isLoading">
        <p v-if="isLoading" class="plugin-loading-status" role="status" aria-live="polite">
          {{ text('loading') }}
        </p>
        <n-empty v-if="!isLoading && plugins.length === 0" :description="text('empty')" />
        <div v-else class="plugin-package-list">
          <n-card
            v-for="plugin in plugins"
            :key="packageKey(plugin)"
            :title="plugin.name"
            class="plugin-package-card"
            :data-test-id="`plugin-package-${plugin.pluginId}-${plugin.version}`"
          >
            <div class="plugin-package-meta">
              <n-text>{{ plugin.pluginId }} · {{ plugin.version }}</n-text>
              <n-tag :type="plugin.status === 'active' ? 'success' : plugin.status === 'invalid' ? 'error' : 'default'">
                {{ packageStatus(plugin) }}
              </n-tag>
            </div>
            <div v-if="plugin.contributions.tools.length > 0" class="plugin-contribution-list">
              <n-text strong>{{ text('tools') }}</n-text>
              <div v-for="tool in plugin.contributions.tools" :key="tool.id" class="plugin-contribution-row">
                <router-link :to="tool.route" class="plugin-contribution-link">
                  <n-text strong>{{ tool.title }}</n-text>
                </router-link>
                <n-text depth="3">{{ tool.description }}</n-text>
                <n-alert v-if="tool.errorCode" type="warning" :show-icon="false">
                  {{ displayPluginError(tool.errorCode) }}
                </n-alert>
              </div>
            </div>
            <n-alert v-if="plugin.status === 'invalid'" type="warning" :show-icon="false" mt-3>
              {{ displayPluginError(plugin.errorCode ?? 'invalid-package') }}
            </n-alert>
            <n-alert v-else-if="plugin.errorCode" type="warning" :show-icon="false" mt-3>
              {{ displayPluginError(plugin.errorCode) }}
            </n-alert>

            <div class="plugin-capability-list">
              <n-text strong>{{ text('requested') }}</n-text>
              <p v-if="plugin.requestedCapabilities.length === 0">{{ text('noCapabilities') }}</p>
              <div v-for="capability in plugin.requestedCapabilities" :key="capability" class="plugin-capability-row">
                <n-checkbox
                  v-if="isCapabilitySupported(plugin, capability) && capabilities.some(item => item.id === capability)"
                  :checked="hasGrant(plugin, capability as DesktopPluginCapability)"
                  :disabled="isBusy || plugin.status !== 'installed'"
                  @update:checked="updateGrant(plugin, capability as DesktopPluginCapability, $event)"
                >
                  {{ capabilities.find(item => item.id === capability)?.label }}
                </n-checkbox>
                <n-text v-else depth="3">{{ capability }} · {{ text('unsupported') }}</n-text>
              </div>
              <n-text depth="3" class="capability-help">{{ text('noGrant') }}</n-text>
            </div>

            <div class="plugin-package-actions">
              <n-button
                v-if="plugin.status === 'active'"
                type="warning"
                :disabled="isBusy"
                @click="disablePlugin(plugin)"
              >
                {{ text('stop') }}
              </n-button>
              <n-button
                v-else
                type="primary"
                :disabled="isBusy || plugin.status === 'invalid'"
                @click="activatePlugin(plugin)"
              >
                {{ text('run') }}
              </n-button>
              <n-button
                quaternary
                :disabled="isBusy || plugin.version === 'unknown'"
                @click="uninstallPlugin(plugin)"
              >
                {{ text('remove') }}
              </n-button>
            </div>
          </n-card>
        </div>
      </n-spin>

      <n-card :title="text('signerTitle')" class="trusted-signer-card">
        <p>{{ text('signerIntro') }}</p>
        <n-alert v-if="signers.length === 0" type="info" :show-icon="false" mb-4>
          {{ text('noSigners') }}
        </n-alert>
        <div v-for="signer in signers" :key="signer.keyId" class="trusted-signer-row">
          <div>
            <n-text strong>{{ signer.keyId }}</n-text>
            <div><code>{{ signer.fingerprint }}</code></div>
            <n-text depth="3">{{ signer.allowedPluginIds.join(', ') }}</n-text>
          </div>
          <n-button type="error" quaternary :disabled="isBusy" @click="revokeSigner(signer)">
            {{ text('revoke') }}
          </n-button>
        </div>

        <div class="signer-form">
          <n-form-item label-for="plugin-signer-key-id" :label="text('keyId')" label-placement="top">
            <n-input
              v-model:value="signerForm.keyId"
              :input-props="{ id: 'plugin-signer-key-id', 'aria-label': text('keyId') }"
              maxlength="128"
              autocomplete="off"
            />
          </n-form-item>
          <n-form-item label-for="plugin-signer-plugin-ids" :label="text('pluginIds')" label-placement="top">
            <n-input
              v-model:value="signerForm.pluginIds"
              :input-props="{ id: 'plugin-signer-plugin-ids', 'aria-label': text('pluginIds') }"
              maxlength="4096"
              autocomplete="off"
            />
          </n-form-item>
          <n-form-item label-for="plugin-signer-public-key" :label="text('publicKey')" label-placement="top">
            <n-input
              v-model:value="signerForm.publicKey"
              :input-props="{ id: 'plugin-signer-public-key', 'aria-label': text('publicKey') }"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 8 }"
              autocomplete="off"
            />
          </n-form-item>
          <n-button :disabled="isBusy" @click="previewSigner">
            {{ text('preview') }}
          </n-button>
          <div v-if="signerPreview" class="signer-preview" role="status">
            <n-text>{{ text('fingerprint') }}</n-text>
            <code>{{ signerPreview.fingerprint }}</code>
            <n-button type="primary" :disabled="isBusy" @click="trustSigner">
              {{ text('trust') }}
            </n-button>
          </div>
        </div>
      </n-card>
    </template>
  </section>
</template>

<style scoped>
.electron-plugin-manager {
  display: grid;
  gap: 16px;
  margin-top: 32px;
}

.plugin-section-heading,
.plugin-package-meta,
.plugin-package-actions,
.trusted-signer-row,
.signer-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.plugin-contribution-link {
  color: inherit;
  text-decoration: none;
}

.plugin-contribution-link:hover {
  text-decoration: underline;
}

.plugin-section-heading h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
}

.plugin-section-heading p,
.trusted-signer-card > p {
  margin: 0;
  color: var(--n-text-color-3);
}

.plugin-package-list {
  display: grid;
  gap: 12px;
}

.plugin-contribution-list {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
}

.plugin-contribution-row {
  display: grid;
  gap: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--n-border-color);
}

.plugin-capability-list {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.plugin-capability-list p {
  margin: 0;
}

.plugin-capability-row {
  padding-left: 8px;
}

.capability-help {
  margin-top: 4px;
}

.plugin-package-actions {
  justify-content: flex-start;
  margin-top: 16px;
}

.trusted-signer-row {
  align-items: flex-start;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--n-border-color);
}

.trusted-signer-row code,
.signer-preview code {
  overflow-wrap: anywhere;
}

.signer-form {
  margin-top: 20px;
}

.signer-preview {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 12px;
}
</style>
