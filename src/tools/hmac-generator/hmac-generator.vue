<script setup lang="ts">
import { type HmacAlgorithm, type HmacEncoding, generateHmac, hmacAlgorithms } from './hmac-generator.service';
import { useCopy } from '@/composable/copy';

const plainText = ref('');
const secret = ref('');
const hashFunction = ref<HmacAlgorithm>('SHA256');
const encoding = ref<HmacEncoding>('Hex');
const hmacResult = computed(() => generateHmac({
  algorithm: hashFunction.value,
  encoding: encoding.value,
  plainText: plainText.value,
  secret: secret.value,
}));
const hmac = computed(() => hmacResult.value.value);
const { copy } = useCopy({ source: hmac });
</script>

<template>
  <div flex flex-col gap-4>
    <c-input-text v-model:value="plainText" multiline raw-text placeholder="Plain text to compute the hash..." rows="3" autosize autofocus label="Plain text to compute the hash" />
    <c-input-text v-model:value="secret" raw-text placeholder="Enter the secret key..." label="Secret key" clearable />

    <c-alert v-if="hmacResult.warnings.length" type="warning">
      {{ hmacResult.warnings.join(' ') }}
    </c-alert>

    <div flex gap-2>
      <c-select
        v-model:value="hashFunction" label="Hashing function"
        flex-1
        placeholder="Select an hashing function..."
        :options="Object.keys(hmacAlgorithms).map((label) => ({ label, value: label }))"
      />
      <c-select
        v-model:value="encoding" label="Output encoding"
        flex-1
        placeholder="Select the result encoding..."
        :options="[
          {
            label: 'Binary (base 2)',
            value: 'Bin',
          },
          {
            label: 'Hexadecimal (base 16)',
            value: 'Hex',
          },
          {
            label: 'Base64 (base 64)',
            value: 'Base64',
          },
          {
            label: 'Base64-url (base 64 with url safe chars)',
            value: 'Base64url',
          },
        ]"
      />
    </div>
    <input-copyable v-model:value="hmac" type="textarea" placeholder="The result of the HMAC..." label="HMAC of your text" />
    <div flex justify-center>
      <c-button @click="copy()">
        Copy HMAC
      </c-button>
    </div>
  </div>
</template>
