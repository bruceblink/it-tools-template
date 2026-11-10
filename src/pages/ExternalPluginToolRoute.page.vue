<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import ExternalPluginV2ToolPage from './ExternalPluginV2Tool.page.vue';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';

const route = useRoute();
const LegacyPage = defineAsyncComponent(() => import('./ExternalPluginTool.page.vue'));
const isV2 = computed(() => externalPluginV2Registry.findByRoute(route.path) !== undefined);
</script>

<template>
  <ExternalPluginV2ToolPage v-if="isV2" />
  <LegacyPage v-else />
</template>
