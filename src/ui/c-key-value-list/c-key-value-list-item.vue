<script lang="ts" setup>
import type { CKeyValueListItem } from './c-key-value-list.types';

const props = defineProps<{ item: CKeyValueListItem }>();
const { item } = toRefs(props);
</script>

<template>
  <div v-if="Array.isArray(item.value)">
    <div v-for="value in item.value" :key="value">
      <c-text-copyable :value="value" :show-icon="item.showCopyButton ?? true" />
    </div>
  </div>
  <div v-else-if="typeof item.value === 'boolean'">
    <c-text-copyable :value="item.value ? 'true' : 'false'" :displayed-value="item.value ? 'Yes' : 'No'" :show-icon="item.showCopyButton ?? true" />
  </div>
  <div v-else-if="typeof item.value === 'number'" font-mono>
    <c-text-copyable :value="String(item.value)" :show-icon="item.showCopyButton ?? true" />
  </div>
  <div v-else-if="item.value === null || item.value === undefined || item.value === ''" op-70>
    {{ item.placeholder ?? 'N/A' }}
  </div>
  <div v-else>
    <c-text-copyable :value="item.value" :show-icon="item.showCopyButton ?? true" />
  </div>
</template>
