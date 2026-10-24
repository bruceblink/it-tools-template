<script setup lang="ts">
import { getTextStatistics } from './text-statistics.service';
import { formatBytes } from '@/utils/convert';

const text = ref('');
const statistics = computed(() => getTextStatistics(text.value));
</script>

<template>
  <c-card>
    <c-input-text v-model:value="text" multiline placeholder="Your text..." rows="5" test-id="text-statistics-input" />

    <div mt-5 flex>
      <n-statistic label="Character count" :value="statistics.characterCount" data-test-id="character-count" flex-1 />
      <n-statistic label="Word count" :value="statistics.wordCount" data-test-id="word-count" flex-1 />
      <n-statistic label="Line count" :value="statistics.lineCount" data-test-id="line-count" flex-1 />
      <n-statistic label="Byte size" :value="formatBytes(statistics.byteSize)" data-test-id="byte-size" flex-1 />
    </div>
  </c-card>
</template>
