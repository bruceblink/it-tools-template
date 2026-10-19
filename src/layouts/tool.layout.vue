<script lang="ts" setup>
import { useRoute } from 'vue-router';
import { useHead } from '@unhead/vue';
import type { ReactiveHead } from '@unhead/vue';

import BaseLayout from './base.layout.vue';
import FavoriteButton from '@/components/FavoriteButton.vue';
import { clearLegacyToolContent, hasMemoryOnlyContent } from '@/tools/input-privacy';

const route = useRoute();

const head = computed<ReactiveHead>(() => ({
  title: `${route.meta.name} - IT Tools`,
  meta: [
    {
      name: 'description',
      content: route.meta?.description as string,
    },
    {
      name: 'keywords',
      content: ((route.meta.keywords ?? []) as string[]).join(','),
    },
  ],
}));
useHead(head);
const { t } = useI18n();

const i18nKey = computed<string>(() => String(route.meta.translationKey ?? route.path.trim().replace('/', '')));
const toolTitle = computed<string>(() => t(`tools.${i18nKey.value}.title`, String(route.meta.name)));
const toolDescription = computed<string>(() => t(`tools.${i18nKey.value}.description`, String(route.meta.description)));
const hasPrivateContent = computed(() => hasMemoryOnlyContent(route.path));
const contentCleanupFailed = ref(false);

// The layout is reused between tools. Clear only the destination's old content
// before its inputs are shown, and never read or restore the removed values.
watch(() => route.path, (toolPath) => {
  contentCleanupFailed.value = !clearLegacyToolContent(toolPath);
}, { immediate: true, flush: 'sync' });
</script>

<template>
  <BaseLayout>
    <div class="tool-layout" :class="{ 'tool-layout--wide': route.meta.contentWidth === 'wide' }">
      <div class="tool-header">
        <div flex flex-nowrap items-center justify-between>
          <n-h1>
            {{ toolTitle }}
          </n-h1>

          <div>
            <FavoriteButton :tool="{ name: String(route.meta.name), path: route.path }" />
          </div>
        </div>

        <div class="separator" />

        <div class="description">
          {{ toolDescription }}
        </div>

        <p v-if="hasPrivateContent" role="note" data-test-id="tool-input-memory-note" text-sm op-70>
          {{ t('inputPrivacy.memoryNotice') }}
        </p>
        <c-alert
          v-if="hasPrivateContent && contentCleanupFailed"
          role="alert"
          data-test-id="tool-input-storage-warning"
          :title="t('inputPrivacy.storageWarningTitle')"
          mt-3
        >
          {{ t('inputPrivacy.storageWarning') }}
        </c-alert>
      </div>
    </div>

    <div class="tool-content" :class="{ 'tool-content--wide': route.meta.contentWidth === 'wide' }">
      <slot />
    </div>
  </BaseLayout>
</template>

<style lang="less" scoped>
.tool-content {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 16px;

  ::v-deep(& > *) {
    flex: 0 1 600px;
  }
}

.tool-layout {
  max-width: 600px;
  margin: 0 auto;
  box-sizing: border-box;

  .tool-header {
    padding: 40px 0;
    width: 100%;

    .n-h1 {
      opacity: 0.9;
      font-size: 40px;
      font-weight: 400;
      margin: 0;
      line-height: 1;
    }

    .separator {
      width: 200px;
      height: 2px;
      background: rgb(161, 161, 161);
      opacity: 0.2;

      margin: 10px 0;
    }

    .description {
      margin: 0;

      opacity: 0.7;
    }
  }
}

.tool-layout--wide {
  width: min(1400px, calc(100% - 48px));
  max-width: none;

  .tool-header {
    padding: 28px 0 20px;
  }
}

.tool-content--wide {
  width: min(1400px, calc(100% - 48px));
  margin: 0 auto;

  ::v-deep(& > *) {
    flex: 1 1 100%;
    width: 100%;
    max-width: none;
  }
}

@media (max-width: 760px) {
  .tool-layout--wide,
  .tool-content--wide {
    width: calc(100% - 24px);
  }
}
</style>
