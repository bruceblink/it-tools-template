<script setup lang="ts">
import { useCopy } from '@/composable/copy';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';
import { base58ToText, isValidBase58, textToBase58, type Base58AlphabetKey } from './base58-string-converter.service';

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
