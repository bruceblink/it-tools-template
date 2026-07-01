<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { jwtHmacAlgorithms, type JwtHmacAlgorithm, parseJwtJson, signJwtText } from './jwt-signer.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const algorithm = useStorage<JwtHmacAlgorithm>('jwt-signer:algorithm', 'HS256');
const secret = useStorage('jwt-signer:secret', 'your-256-bit-secret');
const headerJson = useStorage('jwt-signer:header', JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2));
const payloadJson = useStorage('jwt-signer:payload', JSON.stringify({
  sub: '1234567890',
  name: 'John Doe',
  iat: 1516239022,
}, null, 2));

const algorithmOptions = jwtHmacAlgorithms.map(value => ({ label: value, value }));
const signedJwt = computed(() => withDefaultOnError(() => signJwtText({
  headerJson: headerJson.value,
  payloadJson: payloadJson.value,
  secret: secret.value,
  algorithm: algorithm.value,
}), ''));

const jsonObjectRules = (label: string): UseValidationRule<string>[] => [
  {
    validator: value => parseJwtJson(value, label),
    message: `${label} must be a valid JSON object.`,
  },
];

watch(algorithm, (selectedAlgorithm) => {
  try {
    headerJson.value = JSON.stringify({
      ...parseJwtJson(headerJson.value, 'Header'),
      alg: selectedAlgorithm,
    }, null, 2);
  }
  catch {
    // Leave invalid user input untouched so the validation message can point to it.
  }
});
</script>

<template>
  <div flex flex-col gap-5>
    <div grid grid-cols-1 gap-3 md:grid-cols-2>
      <c-select
        v-model:value="algorithm"
        label="Algorithm"
        :options="algorithmOptions"
      />

      <c-input-text
        v-model:value="secret"
        label="Secret"
        placeholder="HMAC secret"
        raw-text
        type="password"
        clearable
      />
    </div>

    <div grid grid-cols-1 gap-5 lg:grid-cols-2>
      <c-input-text
        v-model:value="headerJson"
        label="Header"
        placeholder="{ &quot;alg&quot;: &quot;HS256&quot;, &quot;typ&quot;: &quot;JWT&quot; }"
        rows="8"
        multiline
        raw-text
        monospace
        :validation-rules="jsonObjectRules('Header')"
      />

      <c-input-text
        v-model:value="payloadJson"
        label="Payload"
        placeholder="{ &quot;sub&quot;: &quot;1234567890&quot; }"
        rows="8"
        multiline
        raw-text
        monospace
        :validation-rules="jsonObjectRules('Payload')"
      />
    </div>

    <n-form-item label="Signed JWT">
      <textarea-copyable :value="signedJwt" language="txt" copy-placement="outside" />
    </n-form-item>
  </div>
</template>
