<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  camelCase,
  capitalCase,
  constantCase,
  dotCase,
  noCase,
  kebabCase,
  pascalCase,
  pathCase,
  sentenceCase,
  snakeCase,
} from 'change-case';
import InputCopyable from '@/components/InputCopyable.vue';

const baseConfig = {
  stripRegexp: /[^A-Za-zÀ-ÖØ-öø-ÿ]+/gi,
};

/**
 * change-case@5 已移除 headerCase
 * 这里本地实现一个等价、稳定的 Header-Case
 */
function headerCase(input: string, config?: { stripRegexp?: RegExp }) {
  const stripped = config?.stripRegexp
    ? input.replace(config.stripRegexp, ' ')
    : input;

  return stripped
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-');
}

const input = ref('lorem ipsum dolor sit amet');

const formats = computed(() => [
  {
    label: 'Lowercase:',
    value: input.value.toLocaleLowerCase(),
  },
  {
    label: 'Uppercase:',
    value: input.value.toLocaleUpperCase(),
  },
  {
    label: 'Camelcase:',
    value: camelCase(input.value),
  },
  {
    label: 'Capitalcase:',
    value: capitalCase(input.value),
  },
  {
    label: 'Constantcase:',
    value: constantCase(input.value),
  },
  {
    label: 'Dotcase:',
    value: dotCase(input.value),
  },
  {
    label: 'Headercase:',
    value: headerCase(input.value, baseConfig),
  },
  {
    label: 'Nocase:',
    value: noCase(input.value),
  },
  {
    label: 'Paramcase:',
    value: kebabCase(input.value),
  },
  {
    label: 'Pascalcase:',
    value: pascalCase(input.value),
  },
  {
    label: 'Pathcase:',
    value: pathCase(input.value),
  },
  {
    label: 'Sentencecase:',
    value: sentenceCase(input.value),
  },
  {
    label: 'Snakecase:',
    value: snakeCase(input.value),
  },
  {
    label: 'Mockingcase:',
    value: input.value
      .split('')
      .map((char, index) =>
        index % 2 === 0 ? char.toUpperCase() : char.toLowerCase(),
      )
      .join(''),
  },
]);

const inputLabelAlignmentConfig = {
  labelPosition: 'left',
  labelWidth: '120px',
  labelAlign: 'right',
};
</script>

<template>
  <c-card>
    <c-input-text
      v-model:value="input"
      label="Your string:"
      placeholder="Your string..."
      raw-text
      v-bind="inputLabelAlignmentConfig"
    />

    <div my-16px divider />

    <InputCopyable
      v-for="format in formats"
      :key="format.label"
      :value="format.value"
      :label="format.label"
      v-bind="inputLabelAlignmentConfig"
      mb-1
    />
  </c-card>
</template>
