<script setup lang="ts">
import { useCopy } from '@/composable/copy';
import { base64ToText, isValidBase64, summarizeBase64Input, textToBase64 } from '@/utils/base64';
import { withDefaultOnError } from '@/utils/defaults';

const encodeUrlSafe = useStorage('base64-string-converter--encode-url-safe', false);
const decodeUrlSafe = useStorage('base64-string-converter--decode-url-safe', false);

const textInput = ref('');
const textByteLength = computed(() => new TextEncoder().encode(textInput.value).length);
const base64Output = computed(() => textToBase64(textInput.value, { makeUrlSafe: encodeUrlSafe.value }));
const { copy: copyTextBase64 } = useCopy({ source: base64Output, text: 'Base64 string copied to the clipboard' });

const base64Input = ref('');
const base64Summary = computed(() => summarizeBase64Input(base64Input.value.trim(), { makeUrlSafe: decodeUrlSafe.value }));
const textOutput = computed(() =>
  withDefaultOnError(() => base64ToText(base64Input.value.trim(), { makeUrlSafe: decodeUrlSafe.value }), ''),
);
const { copy: copyText } = useCopy({ source: textOutput, text: 'String copied to the clipboard' });
const b64ValidationRules = [
  {
    message: 'Invalid base64 string',
    validator: (value: string) => isValidBase64(value.trim(), { makeUrlSafe: decodeUrlSafe.value }),
  },
];
const b64ValidationWatch = [decodeUrlSafe];
</script>

<template>
  <c-card title="String to base64">
    <n-form-item label="Encode URL safe" label-placement="left">
      <n-switch v-model:value="encodeUrlSafe" />
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
      <n-statistic label="Base64 characters" :value="base64Output.length" />
    </div>

    <c-input-text
      label="Base64 of string"
      :value="base64Output"
      multiline
      readonly
      placeholder="The base64 encoding of your string will be here"
      rows="5"
      mb-5
    />

    <div flex justify-center>
      <c-button @click="copyTextBase64()">
        Copy base64
      </c-button>
    </div>
  </c-card>

  <c-card title="Base64 to string">
    <n-form-item label="Decode URL safe" label-placement="left">
      <n-switch v-model:value="decodeUrlSafe" />
    </n-form-item>
    <c-input-text
      v-model:value="base64Input"
      multiline
      placeholder="Your base64 string..."
      rows="5"
      :validation-rules="b64ValidationRules"
      :validation-watch="b64ValidationWatch"
      label="Base64 string to decode"
      mb-5
    />

    <div mb-5 grid grid-cols-1 gap-3 md:grid-cols-5>
      <n-statistic label="Valid Base64" :value="base64Summary.valid ? 'yes' : 'no'" />
      <n-statistic label="Normalized characters" :value="base64Summary.normalizedLength" />
      <n-statistic label="Padding" :value="base64Summary.paddingLength" />
      <n-statistic label="Decoded bytes" :value="base64Summary.byteLength" />
      <n-statistic label="Data URI" :value="base64Summary.hasDataUriPrefix ? 'yes' : 'no'" />
    </div>

    <c-alert v-if="base64Input && !base64Summary.valid" type="warning" mb-5>
      {{ base64Summary.error }}
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
