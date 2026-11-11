<script setup lang="ts">
import { computed, watch } from 'vue';
import { NAlert } from 'naive-ui';
import { useRoute } from 'vue-router';
import ExternalPluginV2ToolPage from './ExternalPluginV2Tool.page.vue';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';
import { applyExternalPluginV2RouteMeta } from './external-plugin-v2-route-meta';

const route = useRoute();
const registration = computed(() => externalPluginV2Registry.tools.value
  .some(tool => tool.path === route.path)
  ? externalPluginV2Registry.findByRoute(route.path)
  : undefined);
const isV2 = computed(() => registration.value !== undefined);
const registryReady = externalPluginV2Registry.initialized;

// 直接打开链接时，注册表可能晚于路由页面加载，因此要在工具出现后补齐元数据。
watch(registration, (tool) => {
  if (tool) {
    applyExternalPluginV2RouteMeta(route.meta, tool.tool);
  }
}, { immediate: true });
</script>

<template>
  <div v-if="!registryReady" role="status">
    Loading plugin tools…
  </div>
  <ExternalPluginV2ToolPage v-else-if="isV2" />
  <n-alert v-else type="warning" :show-icon="false" role="alert">
    This plugin tool is no longer available because legacy plugin tools are not supported.
  </n-alert>
</template>
