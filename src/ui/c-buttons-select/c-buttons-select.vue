<script setup lang="ts" generic="T extends unknown">
import type { CLabelProps } from '../c-label/c-label.types';
import type { CButtonSelectOption } from './c-buttons-select.types';

const props = withDefaults(
  defineProps<{
    options?: readonly CButtonSelectOption<T>[] | readonly string[] | Record<string, T>
    value?: T
    size?: 'small' | 'medium' | 'large'
  } & CLabelProps >(),
  {
    options: () => [],
    value: undefined,
    labelPosition: 'left',
    size: 'medium',
  },
);

const emits = defineEmits(['update:value']);

const { options: rawOptions } = toRefs(props);
const buttonSize = computed<'small' | 'medium' | 'large'>(() => {
  const candidate = props.size;
  return candidate === 'small' || candidate === 'large' ? candidate : 'medium';
});

const options = computed<CButtonSelectOption<T>[]>(() => {
  if (Array.isArray(rawOptions.value)) {
    return rawOptions.value.map((option: string | CButtonSelectOption<T>) => {
      if (typeof option === 'string') {
        return { label: option, value: option };
      }

      return option;
    }) as CButtonSelectOption<T>[];
  }

  return Object.entries(rawOptions.value).map(([label, value]) => ({ label, value })) as CButtonSelectOption<T>[];
});

const value = useVModel(props, 'value', emits);

function selectOption(option: CButtonSelectOption<T>) {
  // @ts-expect-error vue template generic is a bit flacky thanks to withDefaults
  value.value = option.value;
}

function getOptionTestId(option: CButtonSelectOption<T>) {
  const { value: optionValue, label } = option;
  return typeof optionValue === 'string' || typeof optionValue === 'number' ? String(optionValue) : label;
}
</script>

<template>
  <c-label v-bind="props">
    <div class="flex gap-2">
      <c-tooltip
        v-for="(option, index) in options" :key="index"
        :tooltip="option.tooltip"
      >
        <c-button
          :test-id="getOptionTestId(option)"
          :size="buttonSize"
          :type="option.value === value ? 'primary' : 'default'"
          @click="selectOption(option)"
        >
          {{ option.label }}
        </c-button>
      </c-tooltip>
    </div>
  </c-label>
</template>
