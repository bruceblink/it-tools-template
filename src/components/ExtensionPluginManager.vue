<script setup lang="ts">
import { NAlert, NButton, NCard, NCheckbox, NEmpty, NFormItem, NInput, NInputNumber, NSpin, NSwitch, NTag, NText } from 'naive-ui';
import { createQueuedRefresh } from '@/tools/queued-refresh';
import { externalPluginV2SupportedCapabilities } from '@/shared/external-plugin-v2';

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
>> & Pick<NonNullable<Window['itToolsDesktop']>,
  | 'buildPluginSource'
  | 'cancelPluginSourceBuild'
  | 'onPluginSourceBuildProgress'
  | 'listPluginV2Packages'
  | 'listPluginV2Settings'
  | 'updatePluginV2Setting'
  | 'installPluginV2Package'
  | 'uninstallPluginV2Package'
>;

const isDesktop = computed(() => typeof window !== 'undefined' && Boolean(getPluginBridge()));
const isLoading = ref(true);
const isBusy = ref(false);
const plugins = ref<DesktopPluginSnapshot[]>([]);
const v2Packages = ref<DesktopPluginV2Snapshot[]>([]);
const v2Settings = reactive<Record<string, DesktopPluginV2SettingsSnapshot | undefined>>({});
const v2SettingDrafts = reactive<Record<string, string | number | boolean>>({});
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
const sourceBuildForm = reactive({
  owner: '',
  name: '',
  commitSha: '',
  keyId: '',
});

function applySourceBuildPrefill(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const query = new URLSearchParams(window.location.search);
  const owner = query.get('pluginOwner')?.trim() ?? '';
  const name = query.get('pluginName')?.trim() ?? '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name)) {
    return;
  }
  sourceBuildForm.owner = owner;
  sourceBuildForm.name = name;
  const commit = query.get('pluginCommit')?.trim() ?? '';
  if (/^[a-f0-9]{40}$/i.test(commit)) {
    sourceBuildForm.commitSha = commit.toLowerCase();
  }
}

const sourceBuildRequestId = ref<string>();
const sourceBuildProgress = ref<DesktopPluginSourceBuildProgress>();
const sourceBuildError = ref<string>();
type PluginAction = 'run' | 'stop' | 'remove';
const pluginAction = ref<{ key: string; action: PluginAction }>();
type V2PluginAction = 'install' | 'uninstall';
const v2PluginAction = ref<{ key?: string; action: V2PluginAction }>();
const v2SettingAction = ref<{ key: string; settingId: string }>();
const canBuildSource = computed(() => {
  if (typeof window === 'undefined') {
    return false;
  }
  const bridge = getPluginBridge();
  return Boolean(bridge?.buildPluginSource && bridge.cancelPluginSourceBuild && bridge.onPluginSourceBuildProgress);
});
const canManageV2Packages = computed(() => {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  return Boolean(bridge?.listPluginV2Packages && bridge.installPluginV2Package && bridge.uninstallPluginV2Package);
});

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
    title: 'Desktop plugin packages',
    intro: 'Install signed packages, review requested capabilities, and run each package in an isolated window.',
    webOnly: 'External plugin packages are available only in the desktop app. The web version continues to use built-in and first-party extensions.',
    refresh: 'Refresh',
    install: 'Install signed package',
    browseMarketplace: 'Browse plugin marketplace',
    v2Title: 'Host-rendered plugin packages (v2)',
    v2Intro: 'These packages contribute tools to the existing navigation and command search. The host renders their declared fields using the same workspace UI.',
    v2Install: 'Install v2 package',
    v2InstallInProgress: 'Installing v2 package…',
    v2Empty: 'No v2 plugin packages are installed.',
    v2ExecutionPending: 'WASM tools can request runtime information, declared settings, or host OUI data with your approval for each run. Settings are edited in the host; plugin write access and the process runtime are not available.',
    v2Uninstall: 'Uninstall package',
    v2UninstallInProgress: 'Uninstalling v2 package…',
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
    sourceBuildTitle: 'Build and install a fixed source snapshot',
    sourceBuildIntro: 'Use a full commit SHA. Trust the matching public key below first. The desktop app then downloads the reviewed snapshot, asks for an external signing key, validates it, and installs the signed package.',
    sourceOwner: 'GitHub owner',
    sourceName: 'Repository name',
    sourceCommit: 'Full commit SHA',
    sourceKeyId: 'Signer key ID',
    sourceBuild: 'Build and install',
    sourceBuildCancel: 'Cancel build',
    sourceBuildHint: 'The private key is selected by a native file dialog. It is not sent through the renderer.',
    sourceBuildSelectingKey: 'Select the external signing key…',
    sourceBuildBuilding: 'Downloading and validating the fixed source snapshot…',
    sourceBuildInstalling: 'Installing the signed package…',
    sourceBuildCompleted: 'Source snapshot installed.',
    sourceBuildSuccess: 'Source snapshot installed for {name} {version}. Review the source record and capabilities before running it.',
    sourceBuildInvalidRepository: 'Enter a valid GitHub owner, repository name, and full commit SHA.',
    sourceBuildCommitNotFound: 'The commit was not found in the selected GitHub repository.',
    sourceBuildDownloadFailed: 'The fixed source snapshot could not be downloaded.',
    sourceBuildArchiveInvalid: 'The source archive failed safety validation.',
    sourceBuildResourceLimit: 'The source archive exceeds the host resource limits.',
    sourceBuildBusy: 'Another source build is already running.',
    sourceBuildFailed: 'The source snapshot could not be built or installed.',
    onboardingTitle: 'Start with a trusted plugin source',
    onboardingIntro: 'The marketplace is a read-only GitHub directory. Review the repository and publisher before installing a package.',
    onboardingStepTrust: 'Verify the publisher fingerprint, then trust its public key below.',
    onboardingStepInstall: 'Install the signed .itxs file from the publisher.',
    onboardingStepApprove: 'Select only the capabilities you need and approve the desktop prompt when you run it.',
    loading: 'Loading plugin packages…',
    empty: 'No external plugin packages are installed.',
    installed: 'Installed',
    active: 'Running',
    invalid: 'Invalid or untrusted',
    tools: 'Contributed tools',
    requested: 'Requested capabilities',
    capabilitySummary: 'Requested {requested} · supported {supported} · selected {selected} · active {active}',
    capabilitySupported: 'Supported',
    capabilitySelected: 'Selected for next run',
    capabilityActive: 'Active now',
    capabilityUnsupported: 'Unsupported',
    noCapabilities: 'This package requests no host capabilities.',
    unsupported: 'Not supported by this host',
    run: 'Run plugin',
    runInProgress: 'Starting plugin…',
    stop: 'Stop plugin',
    stopInProgress: 'Stopping plugin…',
    remove: 'Uninstall version',
    removeInProgress: 'Removing version…',
    noGrant: 'A capability is used only after you select it and approve the desktop prompt.',
    diagnostics: 'Diagnostics',
    packageId: 'Package ID',
    packageVersion: 'Package version',
    source: 'Install source',
    localPackage: 'Local signed package',
    sourceRepository: 'Repository',
    sourceRelease: 'Release',
    sourceSnapshot: 'Fixed source snapshot',
    sourceCommitLabel: 'Commit',
    sourceHash: 'SHA-256',
    activeContribution: 'Active contribution',
    errorCode: 'Error code',
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
    dataProviderFailed: 'The host data provider request could not be completed.',
    operationFailed: 'The operation could not be completed.',
  },
  zh: {
    title: '桌面插件包',
    intro: '安装已签名的插件包，检查能力请求，并在隔离窗口中运行插件。',
    webOnly: '外部插件包只支持桌面应用。Web 版本继续使用内置和第一方扩展。',
    refresh: '刷新',
    install: '安装已签名的插件包',
    browseMarketplace: '浏览插件市场',
    v2Title: '宿主渲染插件包（v2）',
    v2Intro: '这些插件会把工具加入现有导航和命令搜索。宿主会使用统一工作区界面渲染清单声明的输入和结果。',
    v2Install: '安装 v2 插件包',
    v2InstallInProgress: '正在安装 v2 插件包…',
    v2Empty: '尚未安装 v2 插件包。',
    v2ExecutionPending: 'WASM 工具每次运行时可请求运行时信息、读取声明的设置或查询宿主 OUI 数据，需经你批准。设置由宿主管理；插件写入能力和进程运行时暂未开放。',
    v2Uninstall: '卸载插件包',
    v2UninstallInProgress: '正在卸载 v2 插件包…',
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
    sourceBuildTitle: '从固定源码快照构建并安装',
    sourceBuildIntro: '使用完整 commit SHA。请先在下方信任匹配的公钥。桌面应用随后下载已审查的源码快照，要求选择外部签名私钥，完成校验后安装签名包。',
    sourceOwner: 'GitHub 所有者',
    sourceName: '仓库名称',
    sourceCommit: '完整 commit SHA',
    sourceKeyId: '签名者密钥 ID',
    sourceBuild: '构建并安装',
    sourceBuildCancel: '取消构建',
    sourceBuildHint: '私钥由原生文件选择器选择，不会经过渲染器传递。',
    sourceBuildSelectingKey: '请选择外部签名私钥…',
    sourceBuildBuilding: '正在下载并校验固定源码快照…',
    sourceBuildInstalling: '正在安装已签名插件包…',
    sourceBuildCompleted: '源码快照已安装。',
    sourceBuildSuccess: '已为 {name} {version} 安装源码快照。运行前请检查来源记录和能力。',
    sourceBuildInvalidRepository: '请输入有效的 GitHub 所有者、仓库名称和完整 commit SHA。',
    sourceBuildCommitNotFound: '在所选 GitHub 仓库中没有找到此 commit。',
    sourceBuildDownloadFailed: '无法下载固定源码快照。',
    sourceBuildArchiveInvalid: '源码归档未通过安全校验。',
    sourceBuildResourceLimit: '源码归档超过宿主资源限制。',
    sourceBuildBusy: '已有另一个源码构建正在运行。',
    sourceBuildFailed: '无法构建或安装源码快照。',
    onboardingTitle: '从受信任的插件来源开始',
    onboardingIntro: '插件市场只是 GitHub 仓库的只读目录。安装插件包前，请先审查仓库和发布者。',
    onboardingStepTrust: '核对发布者指纹，然后在下方信任其公钥。',
    onboardingStepInstall: '安装发布者提供的已签名 .itxs 文件。',
    onboardingStepApprove: '只选择需要的能力，并在运行时确认桌面授权提示。',
    loading: '正在加载插件包…',
    empty: '尚未安装外部插件包。',
    installed: '已安装',
    active: '正在运行',
    invalid: '无效或不受信任',
    tools: '贡献的工具',
    requested: '请求的能力',
    capabilitySummary: '已请求 {requested} · 宿主支持 {supported} · 下次运行将授权 {selected} · 当前已授权 {active}',
    capabilitySupported: '宿主支持',
    capabilitySelected: '下次运行将授权',
    capabilityActive: '当前已授权',
    capabilityUnsupported: '宿主不支持',
    noCapabilities: '此插件包没有请求宿主能力。',
    unsupported: '此宿主尚不支持',
    run: '运行插件',
    runInProgress: '正在启动插件…',
    stop: '停止插件',
    stopInProgress: '正在停止插件…',
    remove: '卸载此版本',
    removeInProgress: '正在删除此版本…',
    noGrant: '只有在你选中能力并确认桌面提示后，插件才能使用该能力。',
    diagnostics: '诊断信息',
    packageId: '插件包 ID',
    packageVersion: '插件包版本',
    source: '安装来源',
    localPackage: '本地已签名插件包',
    sourceRepository: '仓库',
    sourceRelease: 'Release',
    sourceSnapshot: '固定源码快照',
    sourceCommitLabel: 'Commit',
    sourceHash: 'SHA-256',
    activeContribution: '当前贡献项',
    errorCode: '错误码',
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
    dataProviderFailed: '无法完成宿主数据提供者请求。',
    operationFailed: '无法完成此操作。',
  },
} as const;

const activeMessages = computed(() => messages[language.value]);
const text = (key: keyof typeof messages.en) => activeMessages.value[key];

function packageKey(plugin: DesktopPluginSnapshot): string {
  return `${plugin.pluginId}:${plugin.version}`;
}

function v2PackageKey(plugin: DesktopPluginV2Snapshot): string {
  return `${plugin.pluginId}:${plugin.version}`;
}

function v2SettingKey(plugin: DesktopPluginV2Snapshot, settingId: string): string {
  return `${v2PackageKey(plugin)}:${settingId}`;
}

/** 从主进程快照读取设置值，保证编辑控件不直接接触持久化文件。 */
function v2SettingsFor(plugin: DesktopPluginV2Snapshot): readonly DesktopPluginV2SettingSnapshot[] {
  return v2Settings[v2PackageKey(plugin)]?.settings ?? [];
}

function v2SettingDraftValue(
  plugin: DesktopPluginV2Snapshot,
  setting: DesktopPluginV2SettingSnapshot,
): string | number | boolean {
  return v2SettingDrafts[v2SettingKey(plugin, setting.id)] ?? setting.value;
}

function v2StringSettingValue(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): string {
  const value = v2SettingDraftValue(plugin, setting);
  return typeof value === 'string' ? value : '';
}

function v2NumberSettingValue(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): number {
  const value = v2SettingDraftValue(plugin, setting);
  return typeof value === 'number' ? value : 0;
}

function v2BooleanSettingValue(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): boolean {
  const value = v2SettingDraftValue(plugin, setting);
  return typeof value === 'boolean' ? value : false;
}

function updateV2SettingDraft(
  plugin: DesktopPluginV2Snapshot,
  setting: DesktopPluginV2SettingSnapshot,
  value: string | number | boolean | null,
): void {
  if (value === null) {
    v2SettingDrafts[v2SettingKey(plugin, setting.id)] = setting.value;
    return;
  }
  v2SettingDrafts[v2SettingKey(plugin, setting.id)] = value;
}

function isV2SettingSaving(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): boolean {
  const action = v2SettingAction.value;
  return action?.key === v2PackageKey(plugin) && action.settingId === setting.id;
}

function isV2SettingDirty(plugin: DesktopPluginV2Snapshot, setting: DesktopPluginV2SettingSnapshot): boolean {
  return !Object.is(v2SettingDraftValue(plugin, setting), setting.value);
}

/** 刷新包列表后同步每个已安装 v2 包的宿主设置快照。 */
function applyV2Settings(snapshot: DesktopPluginV2SettingsSnapshot): void {
  const key = `${snapshot.pluginId}:${snapshot.version}`;
  v2Settings[key] = snapshot;
  for (const setting of snapshot.settings) {
    v2SettingDrafts[`${key}:${setting.id}`] = setting.value;
  }
}

function isV2PluginAction(plugin: DesktopPluginV2Snapshot, action: V2PluginAction): boolean {
  return v2PluginAction.value?.action === action && v2PluginAction.value.key === v2PackageKey(plugin);
}

function isV2CapabilitySupported(capability: string): boolean {
  return externalPluginV2SupportedCapabilities.some(item => item === capability);
}

function v2CapabilityLabel(capability: string): string {
  if (capability === 'runtime.info') {
    return text('v2CapabilityRuntimeInfo');
  }
  if (capability === 'settings.read') {
    return text('v2CapabilitySettingsRead');
  }
  if (capability === 'data.oui') {
    return text('v2CapabilityDataOui');
  }
  return text('v2CapabilityUnsupported');
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

function capabilityLabel(capability: string): string {
  return capabilities.value.find(item => item.id === capability)?.label ?? capability;
}

function hasGrant(plugin: DesktopPluginSnapshot, capability: DesktopPluginCapability): boolean {
  const selected = grantDrafts[packageKey(plugin)];
  return selected?.includes(capability) ?? plugin.grantedCapabilities.includes(capability);
}

function isCapabilitySupported(plugin: DesktopPluginSnapshot, capability: string): capability is DesktopPluginCapability {
  return plugin.supportedCapabilities.includes(capability as DesktopPluginCapability);
}

function capabilityStatus(plugin: DesktopPluginSnapshot, capability: string): 'active' | 'selected' | 'supported' | 'unsupported' {
  if (!isCapabilitySupported(plugin, capability)) {
    return 'unsupported';
  }
  if (plugin.grantedCapabilities.includes(capability)) {
    return 'active';
  }
  return hasGrant(plugin, capability) ? 'selected' : 'supported';
}

function capabilityStatusLabel(status: ReturnType<typeof capabilityStatus>): string {
  if (status === 'active') {
    return text('capabilityActive');
  }
  if (status === 'selected') {
    return text('capabilitySelected');
  }
  if (status === 'unsupported') {
    return text('capabilityUnsupported');
  }
  return text('capabilitySupported');
}

function capabilityStatusType(status: ReturnType<typeof capabilityStatus>): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'selected') {
    return 'warning';
  }
  if (status === 'unsupported') {
    return 'error';
  }
  return 'default';
}

function capabilitySummary(plugin: DesktopPluginSnapshot): string {
  const requested = plugin.requestedCapabilities.length;
  const supported = plugin.requestedCapabilities.filter(capability => isCapabilitySupported(plugin, capability)).length;
  const selected = plugin.requestedCapabilities.filter(capability => (
    isCapabilitySupported(plugin, capability) && hasGrant(plugin, capability)
  )).length;
  const active = plugin.requestedCapabilities.filter(capability => (
    plugin.grantedCapabilities.includes(capability as DesktopPluginCapability)
  )).length;
  return text('capabilitySummary')
    .replace('{requested}', String(requested))
    .replace('{supported}', String(supported))
    .replace('{selected}', String(selected))
    .replace('{active}', String(active));
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
  if (error.startsWith('data-')) {
    return text('dataProviderFailed');
  }
  if (error === 'source-build-key-cancelled' || error === 'source-build-cancelled') {
    return text('operationCancelled');
  }
  if (error === 'source-build-invalid-repository') {
    return text('sourceBuildInvalidRepository');
  }
  if (error === 'source-build-commit-not-found') {
    return text('sourceBuildCommitNotFound');
  }
  if (error === 'source-build-download-failed') {
    return text('sourceBuildDownloadFailed');
  }
  if (error === 'source-build-archive-invalid') {
    return text('sourceBuildArchiveInvalid');
  }
  if (error === 'source-build-resource-limit') {
    return text('sourceBuildResourceLimit');
  }
  if (error === 'source-build-busy') {
    return text('sourceBuildBusy');
  }
  if (error === 'source-build-failed') {
    return text('sourceBuildFailed');
  }
  return `${text('operationFailed')} (${error})`;
}

function isPluginAction(plugin: DesktopPluginSnapshot, action: PluginAction): boolean {
  return pluginAction.value?.key === packageKey(plugin) && pluginAction.value.action === action;
}

function pluginActionMessage(plugin: DesktopPluginSnapshot): string {
  const action = pluginAction.value?.key === packageKey(plugin) ? pluginAction.value.action : undefined;
  if (action === 'run') {
    return text('runInProgress');
  }
  if (action === 'stop') {
    return text('stopInProgress');
  }
  return text('removeInProgress');
}

const sourceBuildProgressMessage = computed(() => {
  const progress = sourceBuildProgress.value;
  if (!progress) {
    return '';
  }
  if (progress.phase === 'selecting-key') {
    return text('sourceBuildSelectingKey');
  }
  if (progress.phase === 'building') {
    return text('sourceBuildBuilding');
  }
  if (progress.phase === 'installing') {
    return text('sourceBuildInstalling');
  }
  if (progress.phase === 'completed') {
    return text('sourceBuildCompleted');
  }
  return text('operationCancelled');
});

async function refreshV2Settings(
  bridge: PluginManagerBridge,
  packages: readonly DesktopPluginV2Snapshot[],
): Promise<void> {
  for (const key of Object.keys(v2Settings)) {
    delete v2Settings[key];
  }
  for (const key of Object.keys(v2SettingDrafts)) {
    delete v2SettingDrafts[key];
  }
  if (!bridge.listPluginV2Settings) {
    return;
  }
  const candidates = packages.filter(plugin => (
    plugin.status === 'installed' && (plugin.manifest.contributions.settings?.length ?? 0) > 0
  ));
  const results = await Promise.all(candidates.map(async plugin => {
    try {
      return await bridge.listPluginV2Settings!({ pluginId: plugin.pluginId, version: plugin.version });
    }
    catch {
      return { ok: false as const, error: 'operation-failed' as const };
    }
  }));
  for (const result of results) {
    if (result.ok) {
      applyV2Settings(result.value);
    }
    else {
      pluginError.value = displayPluginError(result.error);
    }
  }
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
    const [pluginResult, signerResult, v2Result] = await Promise.all([
      bridge.listPlugins(),
      bridge.listTrustedPluginSigners(),
      bridge.listPluginV2Packages?.() ?? Promise.resolve({ ok: true as const, value: [] as DesktopPluginV2Snapshot[] }),
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
    v2Packages.value = v2Result.ok ? v2Result.value : [];
    if (!v2Result.ok) {
      pluginError.value = displayPluginError(v2Result.error);
    }
    if (v2Result.ok) {
      await refreshV2Settings(bridge, v2Result.value);
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    isLoading.value = false;
  }
});

/** 将用户编辑的单个设置交给主进程校验并原子保存。 */
async function saveV2Setting(
  plugin: DesktopPluginV2Snapshot,
  setting: DesktopPluginV2SettingSnapshot,
): Promise<void> {
  const bridge = getPluginBridge();
  const value = v2SettingDraftValue(plugin, setting);
  if (!bridge?.updatePluginV2Setting || !isV2SettingDirty(plugin, setting)) {
    return;
  }
  v2SettingAction.value = { key: v2PackageKey(plugin), settingId: setting.id };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.updatePluginV2Setting({
      pluginId: plugin.pluginId,
      version: plugin.version,
      settingId: setting.id,
      value,
    });
    if (!result.ok) {
      pluginError.value = result.error === 'store-unavailable' || result.error === 'invalid-store'
        ? text('v2SettingsUnavailable')
        : displayPluginError(result.error);
    }
    else {
      applyV2Settings(result.value);
      notice.value = text('v2SettingSaved');
    }
  }
  catch {
    pluginError.value = text('v2SettingsUnavailable');
  }
  finally {
    v2SettingAction.value = undefined;
    isBusy.value = false;
  }
}

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

async function installV2Plugin(): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge?.installPluginV2Package) {
    return;
  }
  v2PluginAction.value = { action: 'install' };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.installPluginV2Package();
    if (!result.ok) {
      pluginError.value = displayPluginError(result.error);
    }
    else if (result.value) {
      notice.value = text('v2Installed');
      await refresh();
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    v2PluginAction.value = undefined;
    isBusy.value = false;
  }
}

async function uninstallV2Plugin(plugin: DesktopPluginV2Snapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge?.uninstallPluginV2Package) {
    return;
  }
  v2PluginAction.value = { key: v2PackageKey(plugin), action: 'uninstall' };
  isBusy.value = true;
  pluginError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.uninstallPluginV2Package(plugin.pluginId, plugin.version);
    if (!result.ok) {
      pluginError.value = displayPluginError(result.error);
    }
    else if (result.value) {
      notice.value = text('v2Uninstalled');
      await refresh();
    }
  }
  catch {
    pluginError.value = text('operationFailed');
  }
  finally {
    v2PluginAction.value = undefined;
    isBusy.value = false;
  }
}

async function buildSourcePlugin(): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge?.buildPluginSource || sourceBuildRequestId.value !== undefined) {
    return;
  }
  const owner = sourceBuildForm.owner.trim();
  const name = sourceBuildForm.name.trim();
  const commitSha = sourceBuildForm.commitSha.trim();
  const keyId = sourceBuildForm.keyId.trim();
  const requestId = `source-build-${Date.now().toString(36)}`;
  sourceBuildRequestId.value = requestId;
  sourceBuildProgress.value = { requestId, phase: 'selecting-key' };
  sourceBuildError.value = undefined;
  pluginError.value = undefined;
  notice.value = undefined;
  isBusy.value = true;
  try {
    const result = await bridge.buildPluginSource({ requestId, owner, name, commitSha, keyId });
    if (!result.ok) {
      sourceBuildError.value = displayPluginError(result.error);
    }
    else {
      notice.value = text('sourceBuildSuccess')
        .replace('{name}', result.value.snapshot.name)
        .replace('{version}', result.value.snapshot.version);
      await refresh();
    }
  }
  catch {
    sourceBuildError.value = text('operationFailed');
  }
  finally {
    sourceBuildRequestId.value = undefined;
    isBusy.value = false;
  }
}

async function cancelSourceBuild(): Promise<void> {
  const requestId = sourceBuildRequestId.value;
  const bridge = getPluginBridge();
  if (!requestId || !bridge?.cancelPluginSourceBuild) {
    return;
  }
  await bridge.cancelPluginSourceBuild(requestId);
}

async function activatePlugin(plugin: DesktopPluginSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  pluginAction.value = { key: packageKey(plugin), action: 'run' };
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
    pluginAction.value = undefined;
    isBusy.value = false;
  }
}

async function disablePlugin(plugin: DesktopPluginSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  pluginAction.value = { key: packageKey(plugin), action: 'stop' };
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
    pluginAction.value = undefined;
    isBusy.value = false;
  }
}

async function uninstallPlugin(plugin: DesktopPluginSnapshot): Promise<void> {
  const bridge = getPluginBridge();
  if (!bridge) {
    return;
  }
  pluginAction.value = { key: packageKey(plugin), action: 'remove' };
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
    pluginAction.value = undefined;
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
let disposeSourceBuildProgress: (() => void) | undefined;

onMounted(() => {
  applySourceBuildPrefill();
  disposePluginStateChange = window.itToolsDesktop?.onPluginStateChanged?.(() => {
    if (!isBusy.value) {
      void refresh();
    }
  });
  disposeSourceBuildProgress = window.itToolsDesktop?.onPluginSourceBuildProgress?.((progress) => {
    if (progress.requestId === sourceBuildRequestId.value) {
      sourceBuildProgress.value = progress;
    }
  });
  void refresh();
});

onUnmounted(() => {
  disposePluginStateChange?.();
  disposeSourceBuildProgress?.();
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
      <div class="plugin-section-actions">
        <n-button v-if="isDesktop" class="plugin-install-action" type="primary" :disabled="isBusy" @click="installPlugin">
          {{ text('install') }}
        </n-button>
        <n-button tag="a" href="/plugin-marketplace" secondary>
          {{ text('browseMarketplace') }}
        </n-button>
        <n-button v-if="isDesktop" :disabled="isLoading || isBusy" @click="refresh">
          {{ text('refresh') }}
        </n-button>
      </div>
    </div>

    <n-alert v-if="!isDesktop" type="info" :show-icon="false" mb-4>
      {{ text('webOnly') }}
    </n-alert>

    <template v-else>
      <n-card
        v-if="!isLoading && plugins.length === 0 && v2Packages.length === 0 && signers.length === 0 && !trustStoreError"
        class="plugin-onboarding-card"
        data-test-id="plugin-manager-onboarding"
      >
        <template #header>{{ text('onboardingTitle') }}</template>
        <p>{{ text('onboardingIntro') }}</p>
        <ol class="plugin-onboarding-steps">
          <li>{{ text('onboardingStepTrust') }}</li>
          <li>{{ text('onboardingStepInstall') }}</li>
          <li>{{ text('onboardingStepApprove') }}</li>
        </ol>
      </n-card>

      <n-card v-if="canBuildSource" class="source-build-card" :title="text('sourceBuildTitle')">
        <p class="source-build-intro">{{ text('sourceBuildIntro') }}</p>
        <div class="source-build-form">
          <n-form-item :label="text('sourceOwner')" label-placement="top">
            <n-input v-model:value="sourceBuildForm.owner" maxlength="39" autocomplete="off" />
          </n-form-item>
          <n-form-item :label="text('sourceName')" label-placement="top">
            <n-input v-model:value="sourceBuildForm.name" maxlength="100" autocomplete="off" />
          </n-form-item>
          <n-form-item :label="text('sourceCommit')" label-placement="top">
            <n-input v-model:value="sourceBuildForm.commitSha" maxlength="40" autocomplete="off" />
          </n-form-item>
          <n-form-item :label="text('sourceKeyId')" label-placement="top">
            <n-input v-model:value="sourceBuildForm.keyId" maxlength="128" autocomplete="off" />
          </n-form-item>
        </div>
        <p class="source-build-hint">{{ text('sourceBuildHint') }}</p>
        <n-alert v-if="sourceBuildProgress" type="info" :show-icon="false" role="status" aria-live="polite">
          <div class="source-build-progress">
            <span>{{ sourceBuildProgressMessage }}</span>
            <n-button
              v-if="sourceBuildRequestId && (sourceBuildProgress.phase === 'selecting-key' || sourceBuildProgress.phase === 'building')"
              size="small"
              secondary
              @click="cancelSourceBuild"
            >
              {{ text('sourceBuildCancel') }}
            </n-button>
          </div>
        </n-alert>
        <n-alert v-if="sourceBuildError" type="error" :show-icon="false" role="alert" mt-3>
          {{ sourceBuildError }}
        </n-alert>
        <n-button
          type="primary"
          :disabled="isBusy || sourceBuildRequestId !== undefined"
          @click="buildSourcePlugin"
        >
          {{ text('sourceBuild') }}
        </n-button>
      </n-card>

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
        <n-empty v-if="!isLoading && plugins.length === 0 && signers.length > 0" :description="text('empty')" />
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
            <div class="plugin-diagnostics" :aria-label="text('diagnostics')">
              <span>{{ text('packageId') }}: <code>{{ plugin.pluginId }}</code></span>
              <span>{{ text('packageVersion') }}: <code>{{ plugin.version }}</code></span>
              <template v-if="plugin.source">
                <span>{{ text('sourceRepository') }}: <code>{{ plugin.source.repository }}</code></span>
                <span v-if="'tagName' in plugin.source">{{ text('sourceRelease') }}: <code>{{ plugin.source.tagName }}</code></span>
                <span v-else>{{ text('sourceSnapshot') }}</span>
                <span>{{ text('sourceCommitLabel') }}: <code>{{ plugin.source.commitSha }}</code></span>
                <span>{{ text('sourceHash') }}: <code>{{ plugin.source.sha256 }}</code></span>
              </template>
              <span v-else>{{ text('source') }}: <code>{{ text('localPackage') }}</code></span>
              <span v-if="plugin.activeContributionId">
                {{ text('activeContribution') }}: <code>{{ plugin.activeContributionId }}</code>
              </span>
              <span v-if="plugin.errorCode" class="plugin-error-code">
                {{ text('errorCode') }}: <code>{{ plugin.errorCode }}</code>
              </span>
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
            <n-alert
              v-if="pluginAction?.key === packageKey(plugin)"
              type="info"
              :show-icon="false"
              role="status"
              aria-live="polite"
              mt-3
            >
              {{ pluginActionMessage(plugin) }}
            </n-alert>

            <div class="plugin-capability-list">
              <n-text strong>{{ text('requested') }}</n-text>
              <n-text depth="3" class="plugin-capability-summary">{{ capabilitySummary(plugin) }}</n-text>
              <p v-if="plugin.requestedCapabilities.length === 0">{{ text('noCapabilities') }}</p>
              <div v-for="capability in plugin.requestedCapabilities" :key="capability" class="plugin-capability-row">
                <div class="plugin-capability-control">
                  <n-checkbox
                    v-if="isCapabilitySupported(plugin, capability) && capabilities.some(item => item.id === capability)"
                    :checked="hasGrant(plugin, capability as DesktopPluginCapability)"
                    :disabled="isBusy || plugin.status !== 'installed'"
                    @update:checked="updateGrant(plugin, capability as DesktopPluginCapability, $event)"
                  >
                    {{ capabilityLabel(capability) }}
                  </n-checkbox>
                  <n-text v-else depth="3">{{ capability }} · {{ text('unsupported') }}</n-text>
                  <n-tag
                    size="small"
                    :type="capabilityStatusType(capabilityStatus(plugin, capability))"
                  >
                    {{ capabilityStatusLabel(capabilityStatus(plugin, capability)) }}
                  </n-tag>
                </div>
              </div>
              <n-text depth="3" class="capability-help">{{ text('noGrant') }}</n-text>
            </div>

            <div class="plugin-package-actions">
              <n-button
                v-if="plugin.status === 'active'"
                type="warning"
                :disabled="isBusy"
                :loading="isPluginAction(plugin, 'stop')"
                @click="disablePlugin(plugin)"
              >
                {{ isPluginAction(plugin, 'stop') ? text('stopInProgress') : text('stop') }}
              </n-button>
              <n-button
                v-else
                type="primary"
                :disabled="isBusy || plugin.status === 'invalid'"
                :loading="isPluginAction(plugin, 'run')"
                @click="activatePlugin(plugin)"
              >
                {{ isPluginAction(plugin, 'run') ? text('runInProgress') : text('run') }}
              </n-button>
              <n-button
                quaternary
                :disabled="isBusy || plugin.version === 'unknown'"
                :loading="isPluginAction(plugin, 'remove')"
                @click="uninstallPlugin(plugin)"
              >
                {{ isPluginAction(plugin, 'remove') ? text('removeInProgress') : text('remove') }}
              </n-button>
            </div>
          </n-card>
        </div>
      </n-spin>

      <n-card v-if="canManageV2Packages" class="v2-plugin-package-card" :title="text('v2Title')">
        <div class="v2-plugin-section-heading">
          <p>{{ text('v2Intro') }}</p>
          <n-button type="primary" :disabled="isBusy || isLoading" :loading="v2PluginAction?.action === 'install'" @click="installV2Plugin">
            {{ v2PluginAction?.action === 'install' ? text('v2InstallInProgress') : text('v2Install') }}
          </n-button>
        </div>
        <n-alert v-if="v2PluginAction?.action === 'install'" type="info" :show-icon="false" role="status" aria-live="polite" mb-4>
          {{ text('v2InstallInProgress') }}
        </n-alert>
        <n-alert type="info" :show-icon="false" mb-4>
          {{ text('v2ExecutionPending') }}
        </n-alert>
        <n-empty v-if="v2Packages.length === 0" :description="text('v2Empty')" />
        <div v-else class="plugin-package-list">
          <n-card
            v-for="plugin in v2Packages"
            :key="v2PackageKey(plugin)"
            :title="plugin.name"
            class="plugin-package-card"
            :data-test-id="`plugin-v2-package-${plugin.pluginId}-${plugin.version}`"
          >
            <div class="plugin-package-meta">
              <n-text>{{ plugin.pluginId }} · {{ plugin.version }}</n-text>
              <n-tag :type="plugin.status === 'installed' ? 'success' : 'error'">
                {{ plugin.status === 'installed' ? text('v2StatusInstalled') : text('v2Invalid') }}
              </n-tag>
            </div>
            <div class="plugin-diagnostics" :aria-label="text('diagnostics')">
              <span>{{ text('packageId') }}: <code>{{ plugin.pluginId }}</code></span>
              <span>{{ text('packageVersion') }}: <code>{{ plugin.version }}</code></span>
              <span>{{ text('v2Runtime') }}: <code>{{ plugin.runtime }}</code></span>
              <span v-if="plugin.errorCode" class="plugin-error-code">
                {{ text('errorCode') }}: <code>{{ plugin.errorCode }}</code>
              </span>
            </div>
            <div v-if="plugin.manifest.requestedCapabilities.length > 0" class="plugin-capability-list">
              <n-text strong>{{ text('v2Capabilities') }}</n-text>
              <div v-for="capability in plugin.manifest.requestedCapabilities" :key="capability" class="plugin-capability-row">
                <div class="plugin-capability-control">
                  <n-tag size="small" :type="isV2CapabilitySupported(capability) ? 'success' : 'warning'">
                    {{ capability }}
                  </n-tag>
                  <n-text depth="3">{{ v2CapabilityLabel(capability) }}</n-text>
                </div>
              </div>
              <n-alert type="info" :show-icon="false">
                {{ text('v2PermissionNotice') }}
              </n-alert>
            </div>
            <div v-if="plugin.manifest.contributions.tools.length > 0" class="plugin-contribution-list">
              <n-text strong>{{ text('v2Tools') }}</n-text>
              <div v-for="tool in plugin.manifest.contributions.tools" :key="tool.id" class="plugin-contribution-row">
                <n-text strong>{{ tool.title }}</n-text>
                <n-text depth="3">{{ tool.description }}</n-text>
              </div>
            </div>
            <div v-if="v2SettingsFor(plugin).length > 0" class="plugin-settings-list">
              <n-text strong>{{ text('v2Settings') }}</n-text>
              <n-text depth="3">{{ text('v2SettingsIntro') }}</n-text>
              <div
                v-for="setting in v2SettingsFor(plugin)"
                :key="setting.id"
                class="plugin-setting-row"
              >
                <div class="plugin-setting-copy">
                  <n-text strong>{{ setting.label }}</n-text>
                  <n-text depth="3">{{ setting.description }}</n-text>
                  <code>{{ setting.id }}</code>
                </div>
                <div class="plugin-setting-control">
                  <n-input
                    v-if="setting.type === 'string'"
                    :value="v2StringSettingValue(plugin, setting)"
                    :maxlength="setting.maxLength"
                    :aria-label="setting.label"
                    @update:value="value => updateV2SettingDraft(plugin, setting, value)"
                  />
                  <n-input-number
                    v-else-if="setting.type === 'number'"
                    :value="v2NumberSettingValue(plugin, setting)"
                    :min="setting.minimum"
                    :max="setting.maximum"
                    :precision="setting.integer ? 0 : undefined"
                    :aria-label="setting.label"
                    @update:value="value => updateV2SettingDraft(plugin, setting, value)"
                  />
                  <n-switch
                    v-else
                    :value="v2BooleanSettingValue(plugin, setting)"
                    :aria-label="setting.label"
                    @update:value="value => updateV2SettingDraft(plugin, setting, value)"
                  />
                  <n-button
                    size="small"
                    type="primary"
                    :disabled="isBusy || !isV2SettingDirty(plugin, setting)"
                    :loading="isV2SettingSaving(plugin, setting)"
                    @click="saveV2Setting(plugin, setting)"
                  >
                    {{ text('v2SaveSetting') }}
                  </n-button>
                </div>
              </div>
            </div>
            <div class="plugin-package-actions">
              <n-button
                quaternary
                :disabled="isBusy"
                :loading="isV2PluginAction(plugin, 'uninstall')"
                @click="uninstallV2Plugin(plugin)"
              >
                {{ isV2PluginAction(plugin, 'uninstall') ? text('v2UninstallInProgress') : text('v2Uninstall') }}
              </n-button>
            </div>
            <n-alert v-if="isV2PluginAction(plugin, 'uninstall')" type="info" :show-icon="false" role="status" aria-live="polite" mt-3>
              {{ text('v2UninstallInProgress') }}
            </n-alert>
          </n-card>
        </div>
      </n-card>

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

.plugin-package-meta,
.plugin-package-actions,
.trusted-signer-row,
.signer-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.plugin-section-heading {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.plugin-section-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.v2-plugin-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

@media (max-width: 560px) {
  .v2-plugin-section-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .plugin-section-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .plugin-install-action {
    grid-column: 1 / -1;
  }

  .plugin-setting-row {
    grid-template-columns: 1fr;
  }
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
.v2-plugin-section-heading p,
.trusted-signer-card > p {
  margin: 0;
  color: var(--n-text-color-3);
}

.plugin-onboarding-card p {
  margin: 0;
  color: var(--n-text-color-3);
}

.source-build-card {
  display: grid;
  gap: 12px;
}

.source-build-intro,
.source-build-hint {
  margin: 0;
  color: var(--n-text-color-3);
}

.source-build-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.source-build-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 560px) {
  .source-build-form {
    grid-template-columns: 1fr;
  }
}

.plugin-onboarding-steps {
  display: grid;
  gap: 8px;
  margin: 16px 0 0;
  padding-left: 24px;
}

.plugin-diagnostics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 8px;
  color: var(--n-text-color-3);
  font-size: 0.82rem;
}

.plugin-diagnostics code {
  overflow-wrap: anywhere;
}

.plugin-error-code {
  color: var(--n-error-color);
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

.plugin-settings-list {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
}

.plugin-setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 360px);
  gap: 12px;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid var(--n-border-color);
}

.plugin-setting-copy,
.plugin-setting-control {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.plugin-setting-copy code {
  overflow-wrap: anywhere;
  color: var(--n-text-color-3);
  font-size: 0.78rem;
}

.plugin-setting-control {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.plugin-capability-list {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.plugin-capability-summary {
  font-size: 0.85rem;
}

.plugin-capability-list p {
  margin: 0;
}

.plugin-capability-row {
  padding-left: 8px;
}

.plugin-capability-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
