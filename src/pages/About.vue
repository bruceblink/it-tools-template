<script setup lang="ts">
import { useHead } from '@vueuse/head';
import { config } from '@/config';

useHead({ title: 'About - IT Tools' });

const links = {
  authorUrl: `[likanug](${config.app.authorUrl})`,
  sponsoringUrl: config.app.sponsoringUrl,
  repositoryUrl: config.app.repositoryUrl,
};
</script>

<template>
  <c-markdown :markdown="$t('about.content', links)" mx-auto mt-50px max-w-600px />
</template>
