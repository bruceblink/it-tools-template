<script setup lang="ts">
import { NButton, useThemeVars } from 'naive-ui';
import type { DesktopUpdateState } from '@/shared/desktop-services/updates';
import { applyWebUpdate, webUpdateReady } from '@/web-updates';

const bridge = window.itToolsDesktop?.updates;
const themeVars = useThemeVars();
const { locale } = useI18n();
const zh = computed(() => locale.value === 'zh');
const state = ref<DesktopUpdateState>();
const failed = ref(false);
let unsubscribe: (() => void) | undefined;
let mounted = false;

const visible = computed(() => bridge
  ? !!state.value?.availableVersion && ['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.value.status)
  : webUpdateReady.value);
const text = computed(() => {
  if (!bridge) {
    return zh.value ? 'Web 新版本已准备就绪。刷新前请保存当前输入。' : 'A new Web version is ready. Save your input before refreshing.';
  }
  const version = state.value?.availableVersion ?? '';
  switch (state.value?.status) {
    case 'downloading':
      return zh.value ? `正在下载 ${version}（${Math.round(state.value.progress?.percent ?? 0)}%）` : `Downloading ${version} (${Math.round(state.value.progress?.percent ?? 0)}%)`;
    case 'downloaded':
      return zh.value ? `${version} 已下载。保存工作后可安装。` : `${version} is ready to install. Save your work first.`;
    case 'installing':
      return zh.value ? '正在启动安装。' : 'Starting installation.';
    case 'error':
      return zh.value ? '更新失败，请重试或打开设置。' : 'Update failed. Retry or open settings.';
    default:
      return zh.value ? `发现新版本 ${version}。` : `Version ${version} is available.`;
  }
});

async function act(action: () => Promise<unknown>) {
  failed.value = false;
  try {
    await action();
  }
  catch {
    failed.value = true;
  }
}

onMounted(() => {
  if (!bridge) {
    return;
  }
  mounted = true;
  let received = false;
  unsubscribe = bridge.onState(value => { received = true; state.value = value; });
  void bridge.getState().then((value) => {
    if (mounted && !received) {
      state.value = value;
    }
  }).catch(() => {
    if (mounted) {
      failed.value = true;
    }
  });
});
onBeforeUnmount(() => { mounted = false; unsubscribe?.(); });
</script>

<template>
  <section v-if="visible" class="update-notice" role="status" data-test-id="update-notice">
    <div>
      <strong>{{ text }}</strong>
      <span v-if="failed" class="update-error">{{ zh ? '操作失败，请重试。' : 'Action failed. Please retry.' }}</span>
    </div>
    <div class="update-actions">
      <n-button v-if="!bridge" size="small" type="primary" @click="act(applyWebUpdate)">
        {{ zh ? '刷新到新版本' : 'Refresh to update' }}
      </n-button>
      <template v-else-if="state">
        <n-button v-if="state.status === 'downloading'" size="small" @click="act(() => bridge!.cancel())">
          {{ zh ? '取消下载' : 'Cancel download' }}
        </n-button>
        <n-button
          v-else-if="state.status === 'downloaded' || state.error === 'install-failed'"
          size="small" type="primary" @click="act(() => bridge!.install())"
        >
          {{ zh ? '退出并安装' : 'Quit and install' }}
        </n-button>
        <n-button
          v-else-if="state.status === 'available' || state.status === 'error'"
          size="small" type="primary" @click="act(() => bridge!.download())"
        >
          {{ zh ? '下载更新' : 'Download update' }}
        </n-button>
        <n-button size="small" @click="$router.push('/settings')">
          {{ zh ? '更新设置' : 'Update settings' }}
        </n-button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.update-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 10px var(--layout-scroll-padding, 26px);
  color: v-bind('themeVars.textColor1');
  background: color-mix(in srgb, #18a058 13%, v-bind('themeVars.bodyColor'));
  border-bottom: 1px solid color-mix(in srgb, #18a058 35%, transparent);
}
.update-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.update-error { display: block; color: #c43836; }
</style>
