<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import InputCopyable from '../../components/InputCopyable.vue';
import type { IntegerBaseConversionOutputs } from './integer-base-converter.model';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';

type IntegerBaseTaskStatus = 'idle' | 'running' | 'invalid' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const inputProps = {
  'labelPosition': 'left',
  'labelWidth': '170px',
  'labelAlign': 'right',
  'readonly': true,
  'mb-2': '',
} as const;

const input = ref('42');
const inputBase = ref(10);
const outputBase = ref(42);
const taskStatus = ref<IntegerBaseTaskStatus>('idle');
const errorMessage = ref('');
const conversionResult = ref<IntegerBaseConversionOutputs>({
  base2: '',
  base8: '',
  base10: '',
  base16: '',
  base64: '',
  custom: '',
});

const taskKey = 'integer-base-converter:convert';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

const taskStatusMessage = computed(() => {
  if (taskStatus.value === 'running') { return 'Calculating...'; }
  if (taskStatus.value === 'input-limit') { return 'Input is too large.'; }
  if (taskStatus.value === 'output-limit') { return 'Output is too large.'; }
  if (taskStatus.value === 'timeout') { return 'Conversion timed out.'; }
  if (taskStatus.value === 'error') { return 'Conversion failed.'; }
  return errorMessage.value;
});

watch([input, inputBase, outputBase], () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  conversionResult.value = { base2: '', base8: '', base10: '', base16: '', base64: '', custom: '' };
  errorMessage.value = '';
  taskStatus.value = 'running';

  // Debounce typing, terminate obsolete conversions, and ignore stale results.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'integer-base-converter',
      value: input.value,
      fromBase: inputBase.value,
      customBase: outputBase.value,
    }, taskLimits.integerBaseConverter);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'integer-base-converter') {
      conversionResult.value = outcome.result.outputs;
      errorMessage.value = outcome.result.errorMessage ?? '';
      taskStatus.value = outcome.result.valid ? 'idle' : 'invalid';
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
});
</script>

<template>
  <div>
    <c-card>
      <c-input-text v-model:value="input" label="Input number" placeholder="Put your number here (ex: 42)" label-position="left" label-width="110px" mb-2 label-align="right" />

      <n-form-item label="Input base" label-placement="left" label-width="110" :show-feedback="false">
        <n-input-number v-model:value="inputBase" max="64" min="2" placeholder="Put your input base here (ex: 10)" w-full />
      </n-form-item>

      <div v-if="taskStatus === 'running'" mt-2 text-center op-70>
        {{ taskStatusMessage }}
      </div>
      <n-alert v-else-if="taskStatusMessage" style="margin-top: 25px" type="error">
        {{ taskStatusMessage }}
      </n-alert>
      <n-divider />

      <InputCopyable
        label="Binary (2)"
        v-bind="inputProps"
        :value="conversionResult.base2"
        placeholder="Binary version will be here..."
      />

      <InputCopyable
        label="Octal (8)"
        v-bind="inputProps"
        :value="conversionResult.base8"
        placeholder="Octal version will be here..."
      />

      <InputCopyable
        label="Decimal (10)"
        v-bind="inputProps"
        :value="conversionResult.base10"
        placeholder="Decimal version will be here..."
      />

      <InputCopyable
        label="Hexadecimal (16)"
        v-bind="inputProps"
        :value="conversionResult.base16"
        placeholder="Hexadecimal version will be here..."
      />

      <InputCopyable
        label="Base64 (64)"
        v-bind="inputProps"
        :value="conversionResult.base64"
        placeholder="Base64 version will be here..."
      />

      <div flex items-baseline>
        <n-input-group style="width: 160px; margin-right: 10px">
          <n-input-group-label> Custom: </n-input-group-label>
          <n-input-number v-model:value="outputBase" max="64" min="2" />
        </n-input-group>

        <InputCopyable
          flex-1
          v-bind="inputProps"
          :value="conversionResult.custom"
          :placeholder="`Base ${outputBase} will be here...`"
        />
      </div>
    </c-card>
  </div>
</template>

<style lang="less" scoped>
.n-input-group:not(:first-child) {
  margin-top: 5px;
}
</style>
