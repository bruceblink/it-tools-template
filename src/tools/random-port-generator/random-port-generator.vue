<script setup lang="ts">
import { generatePort, getPortRangeSummary, PORT_RANGE_PRESETS } from './random-port-generator.model';
import { computedRefreshable } from '@/composable/computedRefreshable';
import { useCopy } from '@/composable/copy';

type PortRangeMode = keyof typeof PORT_RANGE_PRESETS | 'custom';

const rangeMode = useStorage<PortRangeMode>('random-port-generator:range-mode', 'allUnprivileged');
const customMin = useStorage('random-port-generator:custom-min', 3000);
const customMax = useStorage('random-port-generator:custom-max', 9000);
const rangeOptions: Array<{ label: string, value: PortRangeMode }> = [
  { label: 'All unprivileged', value: 'allUnprivileged' },
  { label: 'Registered', value: 'registered' },
  { label: 'Dynamic/private', value: 'dynamic' },
  { label: 'Custom', value: 'custom' },
];
const selectedRange = computed(() => rangeMode.value === 'custom'
  ? { min: customMin.value, max: customMax.value }
  : PORT_RANGE_PRESETS[rangeMode.value]);
const rangeSummary = computed(() => getPortRangeSummary(selectedRange.value));

const [port, refreshPort] = computedRefreshable(() => rangeSummary.value.valid ? String(generatePort(selectedRange.value)) : '');

const { copy } = useCopy({ source: port, text: 'Port copied to the clipboard' });
</script>

<template>
  <c-card>
    <c-buttons-select v-model:value="rangeMode" :options="rangeOptions" label="Range" label-width="120px" mb-3 />

    <div v-if="rangeMode === 'custom'" mb-3 grid grid-cols-1 gap-3 md:grid-cols-2>
      <n-form-item label="Minimum port" :show-feedback="false">
        <n-input-number v-model:value="customMin" :min="0" :max="65535" w-full />
      </n-form-item>
      <n-form-item label="Maximum port" :show-feedback="false">
        <n-input-number v-model:value="customMax" :min="0" :max="65535" w-full />
      </n-form-item>
    </div>

    <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-3>
      <n-statistic label="Minimum" :value="rangeSummary.min" />
      <n-statistic label="Maximum" :value="rangeSummary.max" />
      <n-statistic label="Range size" :value="rangeSummary.size" />
    </div>

    <c-alert v-if="rangeSummary.warning" type="warning" mb-4>
      {{ rangeSummary.warning }}
    </c-alert>

    <div class="port">
      {{ port || '-' }}
    </div>
    <div flex justify-center gap-3>
      <c-button :disabled="!port" @click="copy()">
        Copy
      </c-button>
      <c-button :disabled="!rangeSummary.valid" @click="refreshPort">
        Refresh
      </c-button>
    </div>
  </c-card>
</template>

<style lang="less" scoped>
.port {
  text-align: center;
  font-size: 26px;
  font-weight: 400;
  margin: 10px 0 25px;
}
</style>
