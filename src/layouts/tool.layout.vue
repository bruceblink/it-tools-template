<script lang="ts" setup>
import { useRoute } from 'vue-router';
import { useHead } from '@unhead/vue';
import type { ReactiveHead } from '@unhead/vue';

import BaseLayout from './base.layout.vue';
import FavoriteButton from '@/components/FavoriteButton.vue';
import { clearLegacyToolContent, hasMemoryOnlyContent } from '@/tools/input-privacy';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';

const route = useRoute();
const { t } = useI18n();
// Vue Router 的路由 meta 不深度响应；v2 工具元数据从响应式注册表读取。
const v2Tool = computed(() => externalPluginV2Registry.tools.value.find(({ path }) => path === route.path));
const toolName = computed(() => String(v2Tool.value?.name ?? route.meta.name));
const toolDescriptionValue = computed(() => String(v2Tool.value?.description ?? route.meta.description));
const translationKey = computed<string>(() => String(v2Tool.value?.translationKey ?? route.meta.translationKey ?? route.path.trim().replace('/', '')));
const toolKeywords = computed<readonly string[]>(() => v2Tool.value?.keywords ?? (route.meta.keywords as string[] | undefined) ?? []);
const contentWidth = computed(() => v2Tool.value ? undefined : route.meta.contentWidth);
const toolTitle = computed<string>(() => t(`tools.${translationKey.value}.title`, toolName.value));
const toolDescription = computed<string>(() => t(`tools.${translationKey.value}.description`, toolDescriptionValue.value));

const head = computed<ReactiveHead>(() => ({
  title: `${toolTitle.value} - IT Tools`,
  meta: [
    {
      name: 'description',
      content: toolDescriptionValue.value,
    },
    {
      name: 'keywords',
      content: toolKeywords.value.join(','),
    },
  ],
}));
useHead(head);
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
    <div class="tool-layout" :class="{ 'tool-layout--wide': contentWidth === 'wide' }">
      <div class="tool-header">
        <div flex flex-nowrap items-center justify-between>
          <n-h1>
            {{ toolTitle }}
          </n-h1>

          <div>
            <FavoriteButton :tool="{ name: toolName, path: route.path }" />
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

    <div class="tool-content" :class="{ 'tool-content--wide': contentWidth === 'wide' }">
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
