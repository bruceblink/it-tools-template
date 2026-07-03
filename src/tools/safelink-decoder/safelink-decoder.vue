<script setup lang="ts">
import { parseSafeLinksURL } from './safelink-decoder.service';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { withDefaultOnError } from '@/utils/defaults';

const inputSafeLinkUrl = ref('');
const parsedSafeLink = computed(() => withDefaultOnError(() => parseSafeLinksURL(inputSafeLinkUrl.value), undefined));
const outputDecodedUrl = computed(() => parsedSafeLink.value?.decodedUrl ?? '');
const errorMessage = computed(() => {
  if (!inputSafeLinkUrl.value.trim() || parsedSafeLink.value) {
    return '';
  }

  return withDefaultOnError(() => parseSafeLinksURL(inputSafeLinkUrl.value).decodedUrl, 'Invalid SafeLinks URL provided');
});
const detailRows = computed<Record<string, unknown>[]>(() => parsedSafeLink.value
  ? [
      { name: 'SafeLinks host', value: parsedSafeLink.value.host },
      { name: 'Reserved', value: parsedSafeLink.value.reserved || '-' },
      { name: 'Data', value: parsedSafeLink.value.data || '-' },
      { name: 'Signature data', value: parsedSafeLink.value.sdata || '-' },
    ]
  : []);
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="inputSafeLinkUrl"
      raw-text
      placeholder="Your input Outlook SafeLink Url..."
      autofocus
      label="Your input Outlook SafeLink Url:"
    />

    <c-alert v-if="errorMessage" type="warning">
      {{ errorMessage }}
    </c-alert>

    <c-alert v-if="parsedSafeLink?.warnings.length" type="warning">
      {{ parsedSafeLink.warnings.join(' ') }}
    </c-alert>

    <n-form-item label="Output decoded URL:">
      <TextareaCopyable :value="outputDecodedUrl" :word-wrap="true" />
    </n-form-item>

    <c-table
      v-if="detailRows.length"
      :data="detailRows"
      :headers="[
        { key: 'name', label: 'Field' },
        { key: 'value', label: 'Value' },
      ]"
      description="SafeLinks diagnostic parameters"
    >
      <template #value="{ value }">
        <span v-if="value === '-'" op-60>
          -
        </span>
        <span-copyable v-else :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
