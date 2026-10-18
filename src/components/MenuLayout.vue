<script setup lang="ts">
import { useStyleStore } from '@/stores/style.store';

const styleStore = useStyleStore();
const { isMenuCollapsed, isSmallScreen } = toRefs(styleStore);
const siderPosition = computed(() => (isSmallScreen.value ? 'absolute' : 'static'));
const contentScrollElement = ref<HTMLElement | null>(null);

// Scroll only the main pane so the navigation stays fixed.
function scrollContentToTop() {
  contentScrollElement.value?.scrollTo({ top: 0, behavior: 'auto' });
}
</script>

<template>
  <n-layout has-sider>
    <n-layout-sider
      bordered
      collapse-mode="width"
      :collapsed-width="0"
      :width="240"
      :collapsed="isMenuCollapsed"
      :show-trigger="false"
      :native-scrollbar="false"
      :position="siderPosition"
    >
      <slot name="sider" />
    </n-layout-sider>
    <n-layout class="content" :native-scrollbar="true">
      <div class="content-shell">
        <header class="content-header">
          <slot name="header" :scroll-to-top="scrollContentToTop" />
        </header>
        <div ref="contentScrollElement" class="content-scroll">
          <slot name="content" />
        </div>
      </div>
      <div v-show="isSmallScreen && !isMenuCollapsed" class="overlay" @click="isMenuCollapsed = true" />
    </n-layout>
  </n-layout>
</template>

<style lang="less" scoped>
.overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: #00000080;
  cursor: pointer;
}

.content {
  --layout-scroll-padding: 26px;

  ::v-deep(.n-layout-scroll-container) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  }
}

.n-layout {
  height: 100vh;
}

.content-shell {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.content-header {
  flex: 0 0 auto;
}

.content-scroll {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 var(--layout-scroll-padding) var(--layout-scroll-padding);
  scroll-behavior: smooth;

  @media (prefers-reduced-motion: reduce) {
    scroll-behavior: auto;
  }
}
</style>
