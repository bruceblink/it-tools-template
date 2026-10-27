<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag, NText } from 'naive-ui';
import { useHead } from '@unhead/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { createQueuedRefresh } from '@/tools/queued-refresh';

const route = useRoute();
const { locale } = useI18n();
const language = computed(() => locale.value === 'zh' ? 'zh' : 'en');
const isLoading = ref(true);
const isBusy = ref(false);
const loadError = ref<string>();
const operationError = ref<string>();
const notice = ref<string>();
const plugin = ref<DesktopPluginSnapshot>();
const contribution = ref<DesktopPluginToolContribution>();

type ExternalPluginBridge = {
  activatePlugin: NonNullable<NonNullable<Window['itToolsDesktop']>['activatePlugin']>;
  disablePlugin: NonNullable<NonNullable<Window['itToolsDesktop']>['disablePlugin']>;
  onPluginStateChanged?: NonNullable<NonNullable<Window['itToolsDesktop']>['onPluginStateChanged']>;
};

const messages = {
  en: {
    title: 'External plugin tool',
    loading: 'Loading signed tool metadata…',
    unavailable: 'External plugin tools are available only in the Electron desktop app.',
    notFound: 'This signed plugin tool is not installed or is no longer available.',
    loadError: 'The signed plugin metadata could not be loaded.',
    package: 'Plugin package',
    info: 'This page displays signed metadata only. The tool runs in its own isolated plugin window and is not injected into the host tool registry.',
    run: 'Run plugin',
    stop: 'Stop plugin',
    runStarted: 'Plugin window started.',
    stopped: 'Plugin window stopped.',
    running: 'Running this tool',
    runningElsewhere: 'Another tool is running',
    anotherToolRunning: 'Another contribution from this plugin is running. Running this tool will replace it.',
    rendererCrashed: 'The plugin renderer stopped unexpectedly. Run the tool again to recover.',
    rendererUnresponsive: 'The plugin stopped responding and was closed. Run the tool again to recover.',
    windowClosed: 'The plugin window closed unexpectedly. Run the tool again to recover.',
    operationFailed: 'The plugin operation could not be completed.',
    manage: 'Manage plugin',
    home: 'Back to home',
    invalid: 'The installed package is invalid or no longer trusted.',
  },
  zh: {
    title: '外部插件工具',
    loading: '正在加载已签名的工具元数据…',
    unavailable: '外部插件工具只支持 Electron 桌面应用。',
    notFound: '此签名插件工具尚未安装，或已经不可用。',
    loadError: '无法加载已签名的插件元数据。',
    package: '插件包',
    info: '此页面只显示已签名的元数据。工具在独立的插件隔离窗口中运行，不会注入宿主工具注册表。',
    run: '运行插件',
    stop: '停止插件',
    runStarted: '插件窗口已启动。',
    stopped: '插件窗口已停止。',
    running: '当前工具正在运行',
    runningElsewhere: '另一个工具正在运行',
    anotherToolRunning: '此插件的另一个工具贡献正在运行。运行当前工具会替换它。',
    rendererCrashed: '插件渲染进程意外停止。可以重新运行当前工具来恢复。',
    rendererUnresponsive: '插件无响应，宿主已关闭窗口。可以重新运行当前工具来恢复。',
    windowClosed: '插件窗口意外关闭。可以重新运行当前工具来恢复。',
    operationFailed: '无法完成插件操作。',
    manage: '管理插件',
    home: '返回主页',
    invalid: '已安装的插件包无效或已不再受信任。',
  },
} as const;

const activeMessages = computed(() => messages[language.value]);
const text = (key: keyof typeof messages.en) => activeMessages.value[key];
const isDesktop = computed(() => typeof window !== 'undefined' && Boolean(window.itToolsDesktop?.listPlugins));
const currentContributionActive = computed(() => (
  plugin.value?.status === 'active'
  && plugin.value.activeContributionId === contribution.value?.id
));
const anotherContributionActive = computed(() => (
  plugin.value?.status === 'active' && !currentContributionActive.value
));
const runtimeError = computed(() => {
  switch (contribution.value?.errorCode ?? plugin.value?.errorCode) {
    case 'renderer-crashed': return text('rendererCrashed');
    case 'renderer-unresponsive': return text('rendererUnresponsive');
    case 'window-closed': return text('windowClosed');
    default: return undefined;
  }
});

useHead(computed(() => ({
  title: contribution.value ? `${contribution.value.title} - IT Tools` : `${text('title')} - IT Tools`,
})));

function routeParam(name: string): string {
  const value = route.params[name];
  return Array.isArray(value) ? value[0] ?? '' : String(value ?? '');
}

function getPluginBridge(): ExternalPluginBridge | undefined {
  const bridge = window.itToolsDesktop;
  if (!bridge?.activatePlugin || !bridge.disablePlugin) {
    return undefined;
  }
  return {
    activatePlugin: bridge.activatePlugin,
    disablePlugin: bridge.disablePlugin,
  };
}

const loadContribution = createQueuedRefresh(async () => {
  isLoading.value = true;
  loadError.value = undefined;
  plugin.value = undefined;
  contribution.value = undefined;
  if (!isDesktop.value) {
    isLoading.value = false;
    return;
  }

  try {
    const result = await window.itToolsDesktop!.listPlugins!();
    if (!result.ok) {
      loadError.value = text('loadError');
      return;
    }
    const pluginId = routeParam('pluginId');
    const version = routeParam('version');
    const toolId = routeParam('toolId');
    const candidate = result.value.find(item => item.pluginId === pluginId && item.version === version);
    const match = candidate?.contributions.tools.find(item => item.id === `${pluginId}/${toolId}`);
    if (!candidate || !match) {
      return;
    }
    plugin.value = candidate;
    contribution.value = match;
  }
  catch {
    loadError.value = text('loadError');
  }
  finally {
    isLoading.value = false;
  }
});

async function runPlugin(): Promise<void> {
  const bridge = getPluginBridge();
  const currentPlugin = plugin.value;
  if (!bridge || !currentPlugin || currentPlugin.status === 'invalid' || currentContributionActive.value) {
    return;
  }

  isBusy.value = true;
  operationError.value = undefined;
  notice.value = undefined;
  try {
    const requestedCapabilities = (contribution.value?.capabilities ?? [])
      .filter((capability): capability is DesktopPluginCapability => (
        currentPlugin.supportedCapabilities.includes(capability as DesktopPluginCapability)
      ));
    const result = await bridge.activatePlugin(
      currentPlugin.pluginId,
      currentPlugin.version,
      requestedCapabilities,
      contribution.value?.id,
    );
    if (!result.ok) {
      operationError.value = text('operationFailed');
      return;
    }
    if (result.value) {
      plugin.value = result.value;
      notice.value = text('runStarted');
    }
  }
  catch {
    operationError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

async function stopPlugin(): Promise<void> {
  const bridge = getPluginBridge();
  const currentPlugin = plugin.value;
  if (!bridge || !currentPlugin || !currentContributionActive.value) {
    return;
  }

  isBusy.value = true;
  operationError.value = undefined;
  notice.value = undefined;
  try {
    const result = await bridge.disablePlugin(currentPlugin.pluginId);
    if (!result.ok) {
      operationError.value = text('operationFailed');
      return;
    }
    if (result.value) {
      notice.value = text('stopped');
      await loadContribution();
    }
  }
  catch {
    operationError.value = text('operationFailed');
  }
  finally {
    isBusy.value = false;
  }
}

let disposePluginStateChange: (() => void) | undefined;

onMounted(() => {
  const bridge = getPluginBridge();
  disposePluginStateChange = bridge?.onPluginStateChanged?.((pluginId) => {
    if (pluginId === routeParam('pluginId') && !isBusy.value) {
      void loadContribution();
    }
  });
  void loadContribution();
});

onUnmounted(() => {
  disposePluginStateChange?.();
});
</script>

<template>
  <div class="external-plugin-tool-page">
    <n-spin :show="isLoading">
      <n-alert v-if="!isDesktop" type="info" :show-icon="false">
        {{ text('unavailable') }}
      </n-alert>
      <n-alert v-else-if="loadError" type="error" :show-icon="false">
        {{ loadError }}
      </n-alert>
      <n-alert v-if="operationError" type="error" role="alert" :show-icon="false">
        {{ operationError }}
      </n-alert>
      <n-alert v-if="notice" type="success" role="status" :show-icon="false">
        {{ notice }}
      </n-alert>
      <n-alert v-if="runtimeError" type="warning" role="status" :show-icon="false">
        {{ runtimeError }}
      </n-alert>
      <n-empty v-if="!contribution || !plugin" :description="text('notFound')" />
      <n-card v-else :title="contribution.title">
        <template #header-extra>
          <n-tag :type="plugin.status === 'invalid' ? 'error' : currentContributionActive ? 'success' : 'default'">
            {{ plugin.status === 'invalid'
              ? text('invalid')
              : currentContributionActive
                ? text('running')
                : anotherContributionActive
                  ? text('runningElsewhere')
                  : text('title') }}
          </n-tag>
        </template>
        <p class="external-plugin-tool-description">{{ contribution.description }}</p>
        <p class="external-plugin-tool-package">
          <n-text depth="3">{{ text('package') }}：</n-text>
          <code>{{ plugin.pluginId }} · {{ plugin.version }}</code>
        </p>
        <n-alert type="info" :show-icon="false" mb-4>
          {{ text('info') }}
        </n-alert>
        <n-alert v-if="anotherContributionActive" type="warning" :show-icon="false" mb-4>
          {{ text('anotherToolRunning') }}
        </n-alert>
        <div class="external-plugin-tool-actions">
          <n-button
            v-if="currentContributionActive"
            type="warning"
            :loading="isBusy"
            @click="stopPlugin"
          >
            {{ text('stop') }}
          </n-button>
          <n-button
            v-else-if="plugin.status !== 'invalid'"
            type="primary"
            :loading="isBusy"
            @click="runPlugin"
          >
            {{ text('run') }}
          </n-button>
          <RouterLink to="/settings">
            <n-button>{{ text('manage') }}</n-button>
          </RouterLink>
          <RouterLink to="/">
            <n-button quaternary>{{ text('home') }}</n-button>
          </RouterLink>
        </div>
      </n-card>
    </n-spin>
  </div>
</template>

<style scoped>
.external-plugin-tool-page {
  width: min(720px, calc(100% - 32px));
  margin: 64px auto;
}

.external-plugin-tool-description {
  font-size: 1.1rem;
  line-height: 1.6;
}

.external-plugin-tool-package {
  margin: 16px 0;
}

.external-plugin-tool-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
