<script setup lang="ts">
import { NAlert } from 'naive-ui';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import PluginToolWorkbench from './PluginToolWorkbench.page.vue';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';

const route = useRoute();
// 注册表索引变化时重新查询，确保同一路径的插件更新也能刷新工作台。
const registration = computed(() => externalPluginV2Registry.tools.value
  .some(tool => tool.path === route.path)
  ? externalPluginV2Registry.findByRoute(route.path)
  : undefined);
</script>

<template>
  <PluginToolWorkbench
    v-if="registration"
    :tool="registration.workbench"
    :execute="registration.execute"
  />
  <n-alert v-else type="warning" :show-icon="false" role="alert">
    This plugin tool is no longer registered.
  </n-alert>
</template>
