<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { buildQueryString, buildUrlWithQuery, parseQueryParameters } from './url-query-builder.service';
import { useValidation } from '@/composable/validation';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { withDefaultOnError } from '@/utils/defaults';

const inputElement = ref<HTMLElement>();
const baseUrl = useStorage('url-query-builder:base-url', 'https://example.com/search');
const parameterInput = useStorage('url-query-builder:parameters', 'q=it tools\npage=1\nsort=created_at');
const includeEmptyValues = useStorage('url-query-builder:include-empty-values', true);
const sortKeys = useStorage('url-query-builder:sort-keys', false);

const options = computed(() => ({
  includeEmptyValues: includeEmptyValues.value,
  sortKeys: sortKeys.value,
}));
const queryString = computed(() => withDefaultOnError(() => buildQueryString(parameterInput.value, options.value), ''));
const fullUrl = computed(() => withDefaultOnError(() => buildUrlWithQuery(baseUrl.value, parameterInput.value, options.value), ''));

const parameterValidation = useValidation({
  source: parameterInput,
  rules: [
    {
      validator: value => parseQueryParameters(value),
      message: 'Provided parameters are not valid.',
    },
  ],
});
</script>

<template>
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-3>
    <c-input-text
      v-model:value="baseUrl"
      label="Base URL"
      placeholder="https://example.com/search"
      raw-text
    />

    <n-form-item label="Include empty values" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="includeEmptyValues" />
    </n-form-item>

    <n-form-item label="Sort keys" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="sortKeys" />
    </n-form-item>
  </div>

  <n-form-item
    label="Parameters"
    :feedback="parameterValidation.message"
    :validation-status="parameterValidation.status"
  >
    <c-input-text
      ref="inputElement"
      v-model:value="parameterInput"
      placeholder="q=it tools&#10;page=1"
      rows="12"
      multiline
      raw-text
      monospace
    />
  </n-form-item>

  <n-form-item label="Query string">
    <TextareaCopyable :value="queryString" language="txt" />
  </n-form-item>

  <n-form-item label="Full URL">
    <TextareaCopyable :value="fullUrl" language="txt" :follow-height-of="inputElement" />
  </n-form-item>
</template>
