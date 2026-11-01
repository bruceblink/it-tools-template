<script setup lang="ts">
import { NAlert, NButton, NCard, NProgress, NSwitch } from 'naive-ui';
import type { DesktopUpdateState } from '@/shared/desktop-services/updates';

const bridge = window.itToolsDesktop?.updates;
const { locale } = useI18n();
const zh = computed(() => locale.value === 'zh');
const state = ref<DesktopUpdateState>();
const busy = ref(false);
const failed = ref(false);
let unsubscribe: (() => void) | undefined;
const labels = computed(() => zh.value ? {
  title: '应用更新', automatic: '自动检查更新', check: '检查更新', download: '下载更新',
  cancel: '取消下载', install: '退出并安装', version: '当前版本', next: '可用版本',
  idle: '尚未检查', checking: '正在检查', available: '发现新版本', downloading: '正在下载',
  downloaded: '更新已下载。保存工作后可退出安装。', installing: '正在启动安装',
  'not-available': '已是最新版本', disabled: '开发运行或当前包不支持更新，请使用正式安装包。',
  error: '更新失败，请检查网络后重试。', settings: '无法保存或读取更新设置。',
  failure: '无法访问更新服务，请重试。',
} : {
  title: 'Application updates', automatic: 'Automatically check for updates', check: 'Check for updates',
  download: 'Download update', cancel: 'Cancel download', install: 'Quit and install', version: 'Current version',
  next: 'Available version', idle: 'Not checked yet', checking: 'Checking', available: 'An update is available',
  downloading: 'Downloading', downloaded: 'Update downloaded. Save your work before installing.',
  installing: 'Starting installation', 'not-available': 'You are up to date',
  disabled: 'Updates require an installed release supported by this platform.',
  error: 'Update failed. Check your connection and retry.', settings: 'Update preferences could not be saved or read.',
  failure: 'The update service could not be reached. Please retry.',
});
const working = computed(() => busy.value || ['checking', 'downloading', 'installing'].includes(state.value?.status ?? ''));

async function act(action: () => Promise<DesktopUpdateState>) {
  busy.value = true;
  failed.value = false;
  try {
    state.value = await action();
  }
  catch {
    failed.value = true;
  }
  finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (bridge) {
    unsubscribe = bridge.onState(value => { state.value = value; });
    void act(() => bridge.getState());
  }
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <n-card v-if="bridge" :title="labels.title" class="desktop-updates" data-test-id="desktop-updates">
    <template v-if="state">
      <p>{{ labels.version }}: {{ state.currentVersion }}</p>
      <p v-if="state.availableVersion">{{ labels.next }}: {{ state.availableVersion }}</p>
      <label class="update-preference">
        <n-switch
          :value="state.autoCheck" :disabled="busy" :aria-label="labels.automatic"
          @update:value="value => act(() => bridge!.setAutoCheck(value))"
        />
        {{ labels.automatic }}
      </label>
      <p role="status">{{ labels[state.status] }}</p>
      <n-progress v-if="state.progress" type="line" :percentage="Math.round(state.progress.percent)" />
      <n-alert v-if="state.error === 'settings-failed'" type="error">{{ labels.settings }}</n-alert>
      <div class="update-actions">
        <n-button
          :disabled="working || ['disabled', 'downloaded'].includes(state.status)"
          @click="act(() => bridge!.check())"
        >{{ labels.check }}</n-button>
        <n-button
          v-if="state.availableVersion && ['available', 'error'].includes(state.status) && state.error !== 'install-failed'"
          :disabled="working" @click="act(() => bridge!.download())"
        >{{ labels.download }}</n-button>
        <n-button v-if="state.status === 'downloading'" @click="bridge.cancel()">{{ labels.cancel }}</n-button>
        <n-button
          v-if="state.status === 'downloaded' || state.error === 'install-failed'"
          :disabled="working" type="primary" @click="act(() => bridge!.install())"
        >{{ labels.install }}</n-button>
      </div>
    </template>
    <n-alert v-if="failed" type="error">{{ labels.failure }}</n-alert>
  </n-card>
</template>

<style scoped>
.desktop-updates { margin-bottom: 16px; }
.update-preference, .update-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.update-actions { margin-top: 16px; }
</style>
