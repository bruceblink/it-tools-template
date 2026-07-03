<script setup lang="ts">
import { useCopy } from '@/composable/copy';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';
import {
  base58ToText,
  isValidBase58,
  summarizeBase58Input,
  textToBase58,
  type Base58AlphabetKey,
} from './base58-string-converter.service';

const alphabet = useStorage<Base58AlphabetKey>('base58-string-converter:alphabet', 'bitcoin');

const alphabetOptions: Array<{ label: string; value: Base58AlphabetKey }> = [
  { label: 'Bitcoin', value: 'bitcoin' },
  { label: 'Flickr', value: 'flickr' },
];

const textInput = ref('');
const base58Output = computed(() => textToBase58(textInput.value, { alphabet: alphabet.value }));
const { copy: copyBase58 } = useCopy({ source: base58Output, text: 'Base58 string copied to the clipboard' });

const base58Input = ref('');
const textOutput = computed(() =>
  withDefaultOnError(() => base58ToText(base58Input.value, { alphabet: alphabet.value }), ''),
);
const { copy: copyText } = useCopy({ source: textOutput, text: 'String copied to the clipboard' });

const base58ValidationRules: UseValidationRule<string>[] = [
  {
    message: 'Invalid Base58 string',
    validator: value => isValidBase58(value, { alphabet: alphabet.value }),
  },
];
const base58ValidationWatch = [alphabet];

const textByteLength = computed(() => new TextEncoder().encode(textInput.value).length);
const base58Summary = computed(() => summarizeBase58Input(base58Input.value, { alphabet: alphabet.value }));
</script>

<template>
  <n-form-item label="Alphabet" label-placement="left" :show-feedback="false">
    <n-radio-group v-model:value="alphabet" name="base58-alphabet">
      <n-radio-button
        v-for="option in alphabetOptions"
        :key="option.value"
        :value="option.value"
      >
        {{ option.label }}
      </n-radio-button>
    </n-radio-group>
  </n-form-item>

  <c-card title="String to Base58">
    <c-input-text
      v-model:value="textInput"
      multiline
      placeholder="Put your string here..."
      rows="5"
      label="String to encode"
      raw-text
      mb-5
    />

    <div mb-5 grid grid-cols-1 gap-3 md:grid-cols-2>
      <n-statistic label="UTF-8 bytes" :value="textByteLength" />
      <n-statistic label="Base58 characters" :value="base58Output.length" />
    </div>

    <c-input-text
      label="Base58 of string"
      :value="base58Output"
      multiline
      readonly
      placeholder="The Base58 encoding of your string will be here"
      rows="5"
      mb-5
    />

    <div flex justify-center>
      <c-button @click="copyBase58()">
        Copy Base58
      </c-button>
    </div>
  </c-card>

  <c-card title="Base58 to string">
    <c-input-text
      v-model:value="base58Input"
      multiline
      placeholder="Your Base58 string..."
      rows="5"
      :validation-rules="base58ValidationRules"
      :validation-watch="base58ValidationWatch"
      label="Base58 string to decode"
      mb-5
    />

    <div mb-5 grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Valid Base58" :value="base58Summary.valid ? 'yes' : 'no'" />
      <n-statistic label="Normalized characters" :value="base58Summary.normalizedLength" />
      <n-statistic label="Leading zero bytes" :value="base58Summary.leadingZeroBytes" />
      <n-statistic label="Decoded bytes" :value="base58Summary.byteLength" />
    </div>

    <c-alert v-if="base58Input && !base58Summary.valid" type="warning" mb-5>
      {{ base58Summary.error }}
    </c-alert>

    <c-input-text
      v-model:value="textOutput"
      label="Decoded string"
      placeholder="The decoded string will be here"
      multiline
      rows="5"
      readonly
      mb-5
    />

    <div flex justify-center>
      <c-button @click="copyText()">
        Copy decoded string
      </c-button>
    </div>
  </c-card>
</template>
