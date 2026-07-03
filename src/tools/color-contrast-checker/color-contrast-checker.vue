<script setup lang="ts">
import { checkColorContrast } from './color-contrast-checker.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const foreground = useStorage('color-contrast-checker:foreground', '#111827');
const background = useStorage('color-contrast-checker:background', '#ffffff');

const result = computed(() =>
  withDefaultOnError(() => checkColorContrast(foreground.value, background.value), undefined),
);

function validateColor(value: string) {
  checkColorContrast(value, '#ffffff');

  return true;
}

const colorRules: UseValidationRule<string>[] = [
  {
    validator: validateColor,
    message: 'Invalid CSS color.',
  },
];

const checks = computed(() => {
  if (!result.value) {
    return [];
  }

  return [
    { label: 'Normal text AA', passed: result.value.normalTextAa, threshold: '4.5:1' },
    { label: 'Normal text AAA', passed: result.value.normalTextAaa, threshold: '7:1' },
    { label: 'Large text AA', passed: result.value.largeTextAa, threshold: '3:1' },
    { label: 'Large text AAA', passed: result.value.largeTextAaa, threshold: '4.5:1' },
    { label: 'UI components AA', passed: result.value.uiComponentAa, threshold: '3:1' },
  ];
});
</script>

<template>
  <div>
    <div grid grid-cols-1 gap-4 md:grid-cols-2>
      <c-card title="Colors">
        <n-form-item label="Foreground" label-placement="left" :show-feedback="false">
          <n-color-picker v-model:value="foreground" :modes="['hex']" />
        </n-form-item>
        <c-input-text
          v-model:value="foreground"
          label="Foreground color"
          placeholder="#111827"
          :validation-rules="colorRules"
          mb-4
          clearable
        />

        <n-form-item label="Background" label-placement="left" :show-feedback="false">
          <n-color-picker v-model:value="background" :modes="['hex']" />
        </n-form-item>
        <c-input-text
          v-model:value="background"
          label="Background color"
          placeholder="#ffffff"
          :validation-rules="colorRules"
          clearable
        />
      </c-card>

      <c-card title="Preview">
        <div
          min-h-180px flex flex-col justify-center rounded p-6
          :style="{ color: result?.foreground, backgroundColor: result?.background }"
        >
          <div text-2xl font-bold>
            Sample heading
          </div>
          <div mt-3 text-base>
            The quick brown fox jumps over the lazy dog.
          </div>
          <div mt-4 text-sm op-80>
            Small supporting text
          </div>
        </div>
      </c-card>
    </div>

    <n-table v-if="result" mt-4>
      <tbody>
        <tr>
          <td font-bold>
            Contrast ratio
          </td>
          <td>
            <span-copyable :value="result.ratioText" />
          </td>
        </tr>
        <tr>
          <td font-bold>
            Normalized foreground
          </td>
          <td>
            <span-copyable :value="result.foreground" />
          </td>
        </tr>
        <tr>
          <td font-bold>
            Normalized background
          </td>
          <td>
            <span-copyable :value="result.background" />
          </td>
        </tr>
        <tr v-for="{ label, passed, threshold } in checks" :key="label">
          <td font-bold>
            {{ label }}
          </td>
          <td>
            <n-tag :type="passed ? 'success' : 'error'">
              {{ passed ? 'Pass' : 'Fail' }} ({{ threshold }})
            </n-tag>
          </td>
        </tr>
      </tbody>
    </n-table>
  </div>
</template>
