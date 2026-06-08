<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { dataSizeUnits, getDataSizeConversions, type DataSizeUnitKey } from './data-size-converter.service';

const value = useStorage('data-size-converter:value', 1);
const fromUnit = useStorage<DataSizeUnitKey>('data-size-converter:from-unit', 'megabyte');

const unitOptions = dataSizeUnits.map(unit => ({
  label: `${unit.label} (${unit.symbol})`,
  value: unit.key,
}));

const conversionRows = computed(() => getDataSizeConversions(value.value ?? 0, fromUnit.value));
</script>

<template>
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-2>
    <n-form-item label="Value" :show-feedback="false">
      <n-input-number v-model:value="value" min="0" />
    </n-form-item>

    <c-select
      v-model:value="fromUnit"
      label="From unit"
      :options="unitOptions"
      searchable
    />
  </div>

  <c-table
    :data="conversionRows"
    :headers="[
      { key: 'unit', label: 'Unit' },
      { key: 'symbol', label: 'Symbol' },
      { key: 'value', label: 'Value' },
    ]"
  >
    <template #value="{ value: convertedValue }">
      <span-copyable :value="String(convertedValue)" />
    </template>
  </c-table>
</template>
