<script setup lang="ts">
import { useCopy } from '@/composable/copy';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';
import { hexToText, isValidHex, textToHex } from './hex-string-converter.service';

const uppercaseOutput = useStorage('hex-string-converter:uppercase-output', false);
const groupOutput = useStorage('hex-string-converter:group-output', true);
const allowSeparators = useStorage('hex-string-converter:allow-separators', true);

const textInput = ref('');
const hexOutput = computed(() =>
  textToHex(textInput.value, {
    uppercase: uppercaseOutput.value,
    separator: groupOutput.value ? ' ' : '',
  }),
);
const { copy: copyHex } = useCopy({ source: hexOutput, text: 'Hex string copied to the clipboard' });

const hexInput = ref('');
const textOutput = computed(() =>
  withDefaultOnError(() => hexToText(hexInput.value, { allowSeparators: allowSeparators.value }), ''),
);
const { copy: copyText } = useCopy({ source: textOutput, text: 'String copied to the clipboard' });

const hexValidationRules: UseValidationRule<string>[] = [
  {
    message: 'Invalid hexadecimal string',
    validator: value => isValidHex(value, { allowSeparators: allowSeparators.value }),
  },
];
const hexValidationWatch = [allowSeparators];
</script>

<template>
  <c-card title="String to hex">
    <div mb-3 flex flex-wrap gap-4>
      <n-form-item label="Uppercase" label-placement="left" :show-feedback="false">
        <n-switch v-model:value="uppercaseOutput" />
      </n-form-item>
      <n-form-item label="Group bytes" label-placement="left" :show-feedback="false">
        <n-switch v-model:value="groupOutput" />
      </n-form-item>
    </div>

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
      label="Hex of string"
      :value="hexOutput"
      multiline
      readonly
      placeholder="The hexadecimal encoding of your string will be here"
      rows="5"
      mb-5
    />

    <div flex justify-center>
      <c-button @click="copyHex()">
        Copy hex
      </c-button>
    </div>
  </c-card>

  <c-card title="Hex to string">
    <n-form-item label="Allow separators" label-placement="left">
      <n-switch v-model:value="allowSeparators" />
    </n-form-item>
    <c-input-text
      v-model:value="hexInput"
      multiline
      placeholder="48656c6c6f or 48 65 6c 6c 6f..."
      rows="5"
      :validation-rules="hexValidationRules"
      :validation-watch="hexValidationWatch"
      label="Hex string to decode"
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
