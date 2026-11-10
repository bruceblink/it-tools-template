<script setup lang="ts">
import { NAlert } from 'naive-ui';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import PluginToolWorkbench from './PluginToolWorkbench.page.vue';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';

const route = useRoute();
const registration = computed(() => externalPluginV2Registry.findByRoute(route.path));
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
