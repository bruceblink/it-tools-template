<script setup lang="ts">
import { useThemeVars } from 'naive-ui';
import FavoriteButton from './FavoriteButton.vue';
import type { Tool } from '@/tools/tools.types';

const props = withDefaults(defineProps<{
  tool: Tool & { category: string }
  hoverEnabled?: boolean
}>(), {
  hoverEnabled: true,
});
const { tool, hoverEnabled } = toRefs(props);
const theme = useThemeVars();
</script>

<template>
  <router-link
    :to="tool.path"
    class="tool-card-link decoration-none"
  >
    <c-card class="h-full !border-2px" :class="{ '!hover:border-primary': hoverEnabled }">
      <div flex items-center justify-between>
        <n-icon class="text-neutral-400 dark:text-neutral-600" size="40" :component="tool.icon" />

        <div flex items-center gap-8px>
          <div
            v-if="tool.isNew"
            class="rounded-full px-8px py-3px text-xs text-white dark:text-neutral-800"
            :style="{
              'background-color': theme.primaryColor,
            }"
          >
            {{ $t('toolCard.new') }}
          </div>

          <FavoriteButton :tool="tool" />
        </div>
      </div>

      <div class="truncat my-5px text-lg text-black dark:text-white">
        {{ tool.name }}
      </div>

      <div class="line-clamp-2 text-neutral-500 dark:text-neutral-400">
        {{ tool.description }}
      </div>
    </c-card>
  </router-link>
</template>

<style scoped lang="less">
.tool-card-link {
  display: block;
  height: 100%;
  border-radius: 4px;
  content-visibility: auto;
  contain-intrinsic-size: 0 150px;
}

.tool-card-link :deep(.c-card) {
  transition: box-shadow 180ms ease;
}

.tool-card-link:focus-visible {
  outline: 2px solid var(--primary-color, #18a058);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .tool-card-link :deep(.c-card) {
    transition: none;
  }
}
</style>
