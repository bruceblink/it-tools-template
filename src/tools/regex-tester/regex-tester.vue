<script setup lang="ts">
import { render } from '@regexper/render';
import type { ShadowRootExpose } from 'vue-shadow-dom';
import { useRoute } from 'vue-router';
import { tryOnBeforeUnmount } from '@vueuse/core';
import type { RegexMatch, RegexMatchSummary } from './regex-tester.service';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import { useValidation } from '@/composable/validation';
import { useI18n } from 'vue-i18n';

const route = useRoute();
const { t } = useI18n();
// A route may supply one initial pattern; later edits remain in component memory.
const initialRegex = route.query.regex;
const regex = ref(typeof initialRegex === 'string' ? initialRegex : '');
const text = ref('');
const global = ref(true);
const ignoreCase = ref(false);
const multiline = ref(false);
const dotAll = ref(true);
const unicode = ref(true);
const unicodeSets = ref(false);
const visualizerSVG = ref<ShadowRootExpose>();
const results = shallowRef<RegexMatch[]>([]);
const matchSummary = shallowRef<RegexMatchSummary>({ matchCount: 0, captureCount: 0, groupCount: 0, coveredCharacters: 0, coveragePercent: 0 });
const sample = ref('');
const taskStatus = ref<'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error'>('running');

const regexValidation = useValidation({
  source: regex,
  rules: [
    {
      message: 'Invalid regex: {0}',
      validator: value => value.length <= (taskLimits.regex.maxPatternCharacters ?? 4_096) && new RegExp(value),
      getErrorMessage: (value) => {
        if (value.length > (taskLimits.regex.maxPatternCharacters ?? 4_096)) {
          return t('taskStatus.limit');
        }
        const _ = new RegExp(value);
        return '';
      },
    },
  ],
});
const flags = computed(() => {
  let result = 'd';
  if (global.value) {result += 'g';}
  if (ignoreCase.value) {result += 'i';}
  if (multiline.value) {result += 'm';}
  if (dotAll.value) {result += 's';}
  if (unicode.value) {result += 'u';}
  else if (unicodeSets.value) {result += 'v';}
  return result;
});

const taskMessage = computed(() => {
  if (taskStatus.value === 'running') { return t('taskStatus.calculating'); }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

watch([regex, text, flags], () => {
  const version = ++taskVersion;
  if (taskTimer) {clearTimeout(taskTimer);}
  taskRunner.cancel('regex-tester');
  results.value = [];
  matchSummary.value = { matchCount: 0, captureCount: 0, groupCount: 0, coveredCharacters: 0, coveragePercent: 0 };
  sample.value = '';
  taskStatus.value = 'running';

  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run('regex-tester', version, {
      kind: 'regex',
      regex: regex.value,
      text: text.value,
      flags: flags.value,
    }, taskLimits.regex);
    if (version !== taskVersion) {return;}
    if (outcome.status === 'success' && outcome.result.kind === 'regex') {
      results.value = outcome.result.matches;
      matchSummary.value = outcome.result.summary;
      sample.value = outcome.result.sample;
      taskStatus.value = 'idle';
      return;
    }
    if (outcome.status === 'cancelled') {return;}
    taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) {clearTimeout(taskTimer);}
  taskRunner.cancel('regex-tester');
});

watchEffect(
  async () => {
    const regexValue = regex.value;
    // shadow root is required:
    // @regexper/render append a <defs><style> that broke svg transparency of icons in the whole site
    const visualizer = visualizerSVG.value?.shadow_root;
    if (visualizer) {
      while (visualizer.lastChild) {
        visualizer.removeChild(visualizer.lastChild);
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      try {
        await render(regexValue, svg);
      }
      catch (_) {
      }
      visualizer.appendChild(svg);
    }
  },
);
</script>

<template>
  <div max-w-600px>
    <c-card title="Regex" mb-1>
      <c-input-text
        v-model:value="regex"
        label="Regex to test:"
        placeholder="Put the regex to test"
        multiline
        rows="3"
        :validation="regexValidation"
      />
      <router-link target="_blank" to="/regex-memo" mb-1 mt-1>
        See Regular Expression Cheatsheet
      </router-link>
      <n-space>
        <n-checkbox v-model:checked="global">
          <span title="Global search">Global search. (<code>g</code>)</span>
        </n-checkbox>
        <n-checkbox v-model:checked="ignoreCase">
          <span title="Case-insensitive search">Case-insensitive search. (<code>i</code>)</span>
        </n-checkbox>
        <n-checkbox v-model:checked="multiline">
          <span title="Allows ^ and $ to match next to newline characters.">Multiline(<code>m</code>)</span>
        </n-checkbox>
        <n-checkbox v-model:checked="dotAll">
          <span title="Allows . to match newline characters.">Singleline(<code>s</code>)</span>
        </n-checkbox>
        <n-checkbox v-model:checked="unicode">
          <span title="Unicode; treat a pattern as a sequence of Unicode code points.">Unicode(<code>u</code>)</span>
        </n-checkbox>
        <n-checkbox v-model:checked="unicodeSets">
          <span title="An upgrade to the u mode with more Unicode features.">Unicode Sets (<code>v</code>)</span>
        </n-checkbox>
      </n-space>

      <n-divider />

      <c-input-text
        v-model:value="text"
        label="Text to match:"
        placeholder="Put the text to match"
        multiline
        rows="5"
      />
    </c-card>

    <c-card title="Matches" mb-1 mt-3>
      <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-4>
        <n-statistic label="Matches" :value="matchSummary.matchCount" />
        <n-statistic label="Captures" :value="matchSummary.captureCount" />
        <n-statistic label="Named groups" :value="matchSummary.groupCount" />
        <n-statistic label="Coverage" :value="`${matchSummary.coveragePercent}%`" />
      </div>

      <div v-if="taskStatus === 'running'" py-4 text-center op-70>
        {{ taskMessage }}
      </div>
      <c-alert v-else-if="taskStatus !== 'idle'">
        {{ taskMessage }}
      </c-alert>
      <n-table v-else-if="results.length > 0">
        <thead>
          <tr>
            <th scope="col">
              Index in text
            </th>
            <th scope="col">
              Value
            </th>
            <th scope="col">
              Captures
            </th>
            <th scope="col">
              Groups
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="match of results" :key="match.index">
            <td>{{ match.index }}</td>
            <td>{{ match.value }}</td>
            <td>
              <ul>
                <li v-for="capture in match.captures" :key="capture.name">
                  "{{ capture.name }}" = {{ capture.value }} [{{ capture.start }} - {{ capture.end }}]
                </li>
              </ul>
            </td>
            <td>
              <ul>
                <li v-for="group in match.groups" :key="group.name">
                  "{{ group.name }}" = {{ group.value }} [{{ group.start }} - {{ group.end }}]
                </li>
              </ul>
            </td>
          </tr>
        </tbody>
      </n-table>
      <c-alert v-else>
        No match
      </c-alert>
    </c-card>

    <c-card title="Sample matching text" mt-3>
      <pre style="white-space: pre-wrap; word-break: break-all;">{{ taskStatus === 'running' ? taskMessage : sample }}</pre>
    </c-card>

    <c-card title="Regex Diagram" style="overflow-x: scroll;" mt-3>
      <shadow-root ref="visualizerSVG">
&#xa0;
      </shadow-root>
    </c-card>
  </div>
</template>
