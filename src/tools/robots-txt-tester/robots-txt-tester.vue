<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { testRobotsTxt } from './robots-txt-tester.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleRobotsTxt = `User-agent: *
Disallow: /admin/
Allow: /admin/help$
Sitemap: https://example.com/sitemap.xml

User-agent: Googlebot
Disallow: /private/
Allow: /private/public/
Crawl-delay: 5`;

const robotsTxt = useStorage('robots-txt-tester:robots', sampleRobotsTxt);
const url = useStorage('robots-txt-tester:url', 'https://example.com/admin/settings');
const userAgent = useStorage('robots-txt-tester:user-agent', '*');

const emptyAnalysis = testRobotsTxt('', '/', '*');
const analysis = computed(() =>
  withDefaultOnError(() => testRobotsTxt(robotsTxt.value, url.value, userAgent.value), emptyAnalysis),
);
const ruleRows = computed(() => analysis.value.groups.flatMap(group =>
  group.rules.map(rule => ({
    agents: group.agents.join(', '),
    directive: rule.directive,
    pattern: rule.pattern,
    line: rule.lineNumber,
  })),
));

const urlRules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() !== '' && testRobotsTxt('', value, '*'),
    message: 'URL must be absolute or start with "/".',
  },
];

function accessTagType(allowed: boolean) {
  return allowed ? 'success' : 'error';
}
</script>

<template>
  <div flex flex-col gap-5>
    <div grid grid-cols-1 gap-4 lg:grid-cols-3>
      <c-input-text
        v-model:value="url"
        label="URL to test"
        placeholder="https://example.com/admin/settings"
        raw-text
        :validation-rules="urlRules"
      />

      <c-input-text
        v-model:value="userAgent"
        label="User-Agent"
        placeholder="Googlebot"
        raw-text
      />
    </div>

    <c-input-text
      v-model:value="robotsTxt"
      label="robots.txt"
      placeholder="Paste robots.txt content..."
      rows="12"
      multiline
      raw-text
      monospace
      autofocus
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-5>
      <n-statistic label="Path" :value="analysis.path" />
      <n-statistic label="Matched agents" :value="analysis.matchedAgents.length ? analysis.matchedAgents.join(', ') : '-'" />
      <n-statistic label="Crawl delay" :value="analysis.crawlDelay ?? '-'" />
      <n-statistic label="Sitemaps" :value="analysis.sitemaps.length" />
      <n-statistic label="Warnings" :value="analysis.warnings.length" />
    </div>

    <c-alert v-if="analysis.warnings.length" type="warning">
      {{ analysis.warnings.join(' ') }}
    </c-alert>

    <c-card title="Result">
      <div flex flex-wrap items-center gap-3>
        <n-tag :type="accessTagType(analysis.allowed)">
          {{ analysis.allowed ? 'Allowed' : 'Blocked' }}
        </n-tag>

        <span v-if="analysis.matchedRule" op-80>
          {{ analysis.matchedRule.directive }} {{ analysis.matchedRule.pattern }} (line {{ analysis.matchedRule.lineNumber }})
        </span>
        <span v-else op-60>
          No matching rule
        </span>
      </div>
    </c-card>

    <c-table
      v-if="ruleRows.length"
      :data="ruleRows"
      :headers="[
        { key: 'agents', label: 'Agents' },
        { key: 'directive', label: 'Directive' },
        { key: 'pattern', label: 'Pattern' },
        { key: 'line', label: 'Line' },
      ]"
      description="Parsed robots.txt rules"
    >
      <template #pattern="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>

    <c-table
      v-if="analysis.sitemaps.length"
      :data="analysis.sitemaps.map(sitemap => ({ sitemap }))"
      :headers="[{ key: 'sitemap', label: 'Sitemap' }]"
      description="robots.txt sitemaps"
    >
      <template #sitemap="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
