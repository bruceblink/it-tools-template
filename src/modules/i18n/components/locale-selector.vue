<script setup lang="ts">
import { activateLocale } from '@/plugins/i18n.plugin';

const { availableLocales, locale } = useI18n();
const selectedLocale = ref(locale.value);
const message = useMessage();
let latestSelection = 0;

const localesLong: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  no: 'Norwegian',
  pt: 'Português',
  ru: 'Русский',
  uk: 'Українська',
  zh: '中文',
  vi: 'Tiếng Việt',
};

const localeOptions = computed(() =>
  availableLocales.map(locale => ({
    label: localesLong[locale] ?? locale,
    value: locale,
  })),
);

watch(locale, (value) => {
  selectedLocale.value = value;
});

async function changeLocale(value: string) {
  const requestId = ++latestSelection;
  selectedLocale.value = value;
  try {
    const activeLocale = await activateLocale(value);
    // Ignore a late response when the user already selected another language.
    if (requestId !== latestSelection) {
      return;
    }
    selectedLocale.value = activeLocale;
    try {
      localStorage.setItem('locale', activeLocale);
    }
    catch {
      message.error('The language changed, but the setting could not be saved.');
    }
  }
  catch {
    if (requestId === latestSelection) {
      selectedLocale.value = locale.value;
      message.error('The language could not be loaded. The current language is unchanged.');
    }
  }
}
</script>

<template>
  <c-select
    :value="selectedLocale"
    :options="localeOptions"
    placeholder="Select a language"
    w-100px
    @update:value="changeLocale"
  />
</template>
