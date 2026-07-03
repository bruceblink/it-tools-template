<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  generateSriHashes,
  generateSriHtmlSnippet,
  joinIntegrity,
  type SriAlgorithm,
  type SriCrossorigin,
  type SriResourceType,
} from './sri-hash-generator.service';
import TextareaCopyable from '@/components/TextareaCopyable.vue';

const sampleContent = `console.log("hello");`;

const content = useStorage('sri-hash-generator:content', sampleContent);
const resourceUrl = useStorage('sri-hash-generator:url', 'https://cdn.example.com/app.js');
const resourceType = useStorage<SriResourceType>('sri-hash-generator:type', 'script');
const crossorigin = useStorage<SriCrossorigin>('sri-hash-generator:crossorigin', 'anonymous');
const selectedAlgorithms = useStorage<SriAlgorithm[]>('sri-hash-generator:algorithms', ['sha384']);

const algorithmOptions: { label: string, value: SriAlgorithm }[] = [
  { label: 'SHA-256', value: 'sha256' },
  { label: 'SHA-384', value: 'sha384' },
  { label: 'SHA-512', value: 'sha512' },
];

const hashes = computed(() => generateSriHashes(content.value, selectedAlgorithms.value.length ? selectedAlgorithms.value : ['sha384']));
const integrity = computed(() => joinIntegrity(hashes.value));
const htmlSnippet = computed(() =>
  generateSriHtmlSnippet({
    type: resourceType.value,
    url: resourceUrl.value,
    integrity: integrity.value,
    crossorigin: crossorigin.value,
  }),
);
const hashRows = computed<Record<string, unknown>[]>(() => hashes.value.map(hash => ({
  algorithm: hash.algorithm,
  digest: hash.digest,
  integrity: hash.integrity,
})));
</script>

<template>
  <div flex flex-col gap-5>
    <div grid grid-cols-1 gap-4 lg:grid-cols-3>
      <c-input-text
        v-model:value="resourceUrl"
        label="Resource URL"
        placeholder="https://cdn.example.com/app.js"
        raw-text
      />

      <c-select
        v-model:value="resourceType"
        label="Resource type"
        :options="[
          { label: 'Script', value: 'script' },
          { label: 'Stylesheet', value: 'stylesheet' },
        ]"
      />

      <c-select
        v-model:value="crossorigin"
        label="Crossorigin"
        :options="[
          { label: 'anonymous', value: 'anonymous' },
          { label: 'use-credentials', value: 'use-credentials' },
          { label: 'none', value: 'none' },
        ]"
      />
    </div>

    <n-form-item label="Algorithms" :show-feedback="false">
      <n-checkbox-group v-model:value="selectedAlgorithms">
        <n-checkbox
          v-for="algorithm in algorithmOptions"
          :key="algorithm.value"
          :value="algorithm.value"
        >
          {{ algorithm.label }}
        </n-checkbox>
      </n-checkbox-group>
    </n-form-item>

    <c-input-text
      v-model:value="content"
      label="Resource content"
      placeholder="Paste JavaScript or CSS content..."
      rows="12"
      multiline
      raw-text
      monospace
      autofocus
    />

    <div grid grid-cols-1 gap-5 lg:grid-cols-2>
      <n-form-item label="Integrity attribute">
        <TextareaCopyable :value="integrity" language="txt" />
      </n-form-item>

      <n-form-item label="HTML snippet">
        <TextareaCopyable :value="htmlSnippet" language="html" />
      </n-form-item>
    </div>

    <c-table
      :data="hashRows"
      :headers="[
        { key: 'algorithm', label: 'Algorithm' },
        { key: 'digest', label: 'Base64 digest' },
        { key: 'integrity', label: 'Integrity' },
      ]"
      description="Generated SRI hashes"
    >
      <template #digest="{ value }">
        <span-copyable :value="String(value)" />
      </template>

      <template #integrity="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
