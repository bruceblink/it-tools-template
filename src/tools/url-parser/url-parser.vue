<script setup lang="ts">
import InputCopyable from '../../components/InputCopyable.vue';
import { parseUrlDetails } from './url-parser.service';
import { isNotThrowing } from '@/utils/boolean';
import { withDefaultOnError } from '@/utils/defaults';

const urlToParse = ref('https://me:pwd@it-tools.tech:3000/url-parser?key1=value&key2=value2#the-hash');

const urlParsed = computed(() => withDefaultOnError(() => parseUrlDetails(urlToParse.value), undefined));
const urlValidationRules = [
  {
    validator: (value: string) => isNotThrowing(() => parseUrlDetails(value)),
    message: 'Invalid url',
  },
];

const properties = [
  { title: 'Href', key: 'href' },
  { title: 'Protocol', key: 'protocol' },
  { title: 'Username', key: 'username' },
  { title: 'Password', key: 'password' },
  { title: 'Origin', key: 'origin' },
  { title: 'Hostname', key: 'hostname' },
  { title: 'Port', key: 'port' },
  { title: 'Path', key: 'pathname' },
  { title: 'Params', key: 'search' },
] as const;
</script>

<template>
  <c-card>
    <c-input-text
      v-model:value="urlToParse"
      label="Your url to parse:"
      placeholder="Your url to parse..."
      raw-text
      :validation-rules="urlValidationRules"
    />

    <n-divider />

    <c-alert v-if="urlParsed?.warnings.length" type="warning" mb-4>
      {{ urlParsed.warnings.join(' ') }}
    </c-alert>

    <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Path segments" :value="urlParsed?.summary.pathSegments ?? 0" />
      <n-statistic label="Query parameters" :value="urlParsed?.summary.queryParameters ?? 0" />
      <n-statistic label="Unique parameter names" :value="urlParsed?.summary.uniqueParameterNames ?? 0" />
      <n-statistic label="Duplicate names" :value="urlParsed?.summary.duplicateParameterNames ?? 0" />
    </div>

    <InputCopyable
      v-for="{ title, key } in properties"
      :key="key"
      :label="title"
      :value="(urlParsed?.[key] as string) ?? ''"
      readonly
      label-position="left"
      label-width="110px"
      mb-2
      placeholder=" "
    />

    <div
      v-for="({ key, value }, index) in urlParsed?.parameters ?? []"
      :key="`${key}-${index}`"
      mb-2
      w-full
      flex
    >
      <div style="flex: 1 0 110px">
        <icon-mdi-arrow-right-bottom />
      </div>

      <InputCopyable :value="key" readonly />
      <InputCopyable :value="value" readonly />
    </div>
  </c-card>
</template>

<style lang="less" scoped>
.n-input-group-label {
  text-align: right;
}
.n-input-group {
  margin: 2px 0;
}
</style>
