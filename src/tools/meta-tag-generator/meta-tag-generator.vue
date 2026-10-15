<script setup lang="ts">
import { generateMeta } from '@it-tools/oggen';
import _ from 'lodash';
import { image, ogSchemas, twitter, website } from './og-schemas';
import type { OGSchemaType, OGSchemaTypeElementSelect } from './OGSchemaType.type';
import type { CSelectOption } from '@/ui/c-select/c-select.types';
import TextareaCopyable from '@/components/TextareaCopyable.vue';

// Since type guards do not work in template

const metadata = ref<{ type: string; [k: string]: any }>({
  'type': 'website',
  'twitter:card': 'summary_large_image',
});

watch(
  () => ref(metadata.value.type),
  (_ignored, prevSection) => {
    const section = ogSchemas[prevSection.value];

    if (!section) {
      return;
    }

    section.elements.forEach(({ key }) => {
      metadata.value[key] = '';
    });
  },
);

const sections = computed(() => {
  const secs: OGSchemaType[] = [website, image, twitter];
  const additionalSchema = ogSchemas[metadata.value.type];

  if (additionalSchema) {
    secs.push(additionalSchema);
  }

  return secs;
});

// The shared select accepts flat string options; group labels must never become metadata values.
function normalizeSelectOptions(options: OGSchemaTypeElementSelect['options']): CSelectOption<string>[] {
  return options.flatMap((option) => {
    if (isRecord(option) && option.type === 'group') {
      const children = Array.isArray(option.children) ? option.children : [];
      return children.flatMap((child: unknown) => normalizeSelectOption(child));
    }

    return normalizeSelectOption(option);
  });
}

function normalizeSelectOption(option: unknown): CSelectOption<string>[] {
  if (!isRecord(option) || typeof option.label !== 'string' || typeof option.value !== 'string') {
    return [];
  }

  return [{ label: option.label, value: option.value }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const metaTags = computed(() => {
  const twitterMeta = _.chain(metadata.value)
    .pickBy((_value, k) => k.startsWith('twitter:'))
    .mapKeys((_value, k) => k.replace(/^twitter:/, ''))
    .value();

  const otherMeta = _.pickBy(metadata.value, (_value, k) => !k.startsWith('twitter:'));

  return generateMeta({ ...otherMeta, twitter: twitterMeta }, { generateTwitterCompatibleMeta: true });
});
</script>

<template>
  <div>
    <div v-for="{ name, elements } of sections" :key="name" style="margin-bottom: 15px">
      <div mb-5px>
        {{ name }}
      </div>

      <n-input-group v-for="{ key, type, label, placeholder, ...element } of elements" :key="key">
        <n-input-group-label style="flex: 0 0 110px">
          {{ label }}
        </n-input-group-label>

        <c-input-text v-if="type === 'input'" v-model:value="metadata[key]" :placeholder="placeholder" clearable />
        <n-dynamic-input
          v-else-if="type === 'input-multiple'"
          v-model:value="metadata[key]"
          :min="1"
          :placeholder="placeholder"
          :default-value="['']"
          :show-sort-button="true"
        />

        <c-select
          v-else-if="type === 'select'"
          v-model:value="metadata[key]"
          w-full
          :placeholder="placeholder"
          :options="normalizeSelectOptions((element as OGSchemaTypeElementSelect).options)"
        />
      </n-input-group>
    </div>
  </div>
  <div>
    <n-form-item label="Your meta tags">
      <TextareaCopyable :value="metaTags" language="html" />
    </n-form-item>
  </div>
</template>

<style lang="less" scoped>
.n-input-group {
  margin-bottom: 5px;
}

::v-deep(.n-form-item-blank) {
  min-height: 0 !important;
}
::v-deep(.n-dynamic-input-item) {
  margin-bottom: 5px;
}
</style>
