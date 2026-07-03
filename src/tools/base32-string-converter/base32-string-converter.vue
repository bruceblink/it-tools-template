<script setup lang="ts">
import { useCopy } from '@/composable/copy';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';
import { base32ToText, isValidBase32, summarizeBase32Input, textToBase32 } from './base32-string-converter.service';

const includePadding = useStorage('base32-string-converter:include-padding', true);
const allowSeparators = useStorage('base32-string-converter:allow-separators', true);

const textInput = ref('');
const textByteLength = computed(() => new TextEncoder().encode(textInput.value).length);
const base32Output = computed(() => textToBase32(textInput.value, { padding: includePadding.value }));
const { copy: copyBase32 } = useCopy({ source: base32Output, text: 'Base32 string copied to the clipboard' });

const base32Input = ref('');
const base32Summary = computed(() => summarizeBase32Input(base32Input.value, { allowSeparators: allowSeparators.value }));
const textOutput = computed(() =>
  withDefaultOnError(() => base32ToText(base32Input.value, { allowSeparators: allowSeparators.value }), ''),
);
const { copy: copyText } = useCopy({ source: textOutput, text: 'String copied to the clipboard' });

const base32ValidationRules: UseValidationRule<string>[] = [
  {
    message: 'Invalid Base32 string',
    validator: value => isValidBase32(value, { allowSeparators: allowSeparators.value }),
  },
];
const base32ValidationWatch = [allowSeparators];
</script>

<template>
  <c-card title="String to Base32">
    <n-form-item label="Include padding" label-placement="left">
      <n-switch v-model:value="includePadding" />
    </n-form-item>
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
      <n-statistic label="Base32 characters" :value="base32Output.length" />
    </div>

    <c-input-text
      label="Base32 of string"
      :value="base32Output"
      multiline
      readonly
      placeholder="The Base32 encoding of your string will be here"
      rows="5"
      mb-5
    />

    <div flex justify-center>
      <c-button @click="copyBase32()">
        Copy Base32
      </c-button>
    </div>
  </c-card>

  <c-card title="Base32 to string">
    <n-form-item label="Allow spaces and hyphens" label-placement="left">
      <n-switch v-model:value="allowSeparators" />
    </n-form-item>
    <c-input-text
      v-model:value="base32Input"
      multiline
      placeholder="Your Base32 string..."
      rows="5"
      :validation-rules="base32ValidationRules"
      :validation-watch="base32ValidationWatch"
      label="Base32 string to decode"
      mb-5
    />

    <div mb-5 grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Valid Base32" :value="base32Summary.valid ? 'yes' : 'no'" />
      <n-statistic label="Normalized characters" :value="base32Summary.normalizedLength" />
      <n-statistic label="Padding" :value="base32Summary.paddingLength" />
      <n-statistic label="Decoded bytes" :value="base32Summary.byteLength" />
    </div>

    <c-alert v-if="base32Input && !base32Summary.valid" type="warning" mb-5>
      {{ base32Summary.error }}
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
