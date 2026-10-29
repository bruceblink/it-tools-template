<script setup lang="ts">
import { defineAsyncComponent, shallowRef, watch, type Component } from 'vue';
import { useRoute } from 'vue-router';
import ToolRouteLoading from '@/components/ToolRouteLoading.vue';

type ToolLoader = () => Promise<Component>;
const route = useRoute();
const toolComponent = shallowRef<Component>();

watch(
  () => route.meta.toolLoader as ToolLoader | undefined,
  (loader) => {
    toolComponent.value = loader
      ? defineAsyncComponent({
          loader,
          delay: 0,
          suspensible: false,
          loadingComponent: ToolRouteLoading,
        })
      : undefined;
  },
  { immediate: true },
);
</script>

<template>
  <component :is="toolComponent" v-if="toolComponent" />
  <ToolRouteLoading v-else />
</template>
