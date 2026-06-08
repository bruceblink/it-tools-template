<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { getLengthConversions, lengthUnits, type LengthUnitKey } from './length-converter.service';

const value = useStorage('length-converter:value', 1);
const fromUnit = useStorage<LengthUnitKey>('length-converter:from-unit', 'meter');

const unitOptions = lengthUnits.map(unit => ({
  label: `${unit.label} (${unit.symbol})`,
  value: unit.key,
}));

const conversionRows = computed(() => getLengthConversions(value.value ?? 0, fromUnit.value));
</script>

<template>
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-2>
    <n-form-item label="Value" :show-feedback="false">
      <n-input-number v-model:value="value" />
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
