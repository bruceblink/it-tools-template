import englishMessages from '../../locales/en.yml';
import desktopEnglishMessages from '../../locales/en.desktop.yml';
import { get } from '@vueuse/core';
import type { Plugin } from 'vue';
import { createI18n, type LocaleMessageValue, type VueMessageType } from 'vue-i18n';

export const supportedLocaleCodes = ['en', 'de', 'es', 'fr', 'no', 'pt', 'uk', 'vi', 'zh'] as const;
export type SupportedLocale = typeof supportedLocaleCodes[number];
type LocaleMessages = Record<string, LocaleMessageValue<VueMessageType>>;

function withDesktopMessages(base: LocaleMessages, desktop: LocaleMessages): LocaleMessages {
  return { ...base, tools: { ...(base.tools as LocaleMessages), ...(desktop.tools as LocaleMessages) } };
}

const localeLoaders: Record<Exclude<SupportedLocale, 'en'>, () => Promise<LocaleMessages>> = {
  de: async () => (await import('../../locales/de.yml')).default,
  es: async () => (await import('../../locales/es.yml')).default,
  fr: async () => (await import('../../locales/fr.yml')).default,
  no: async () => (await import('../../locales/no.yml')).default,
  pt: async () => (await import('../../locales/pt.yml')).default,
  uk: async () => (await import('../../locales/uk.yml')).default,
  vi: async () => (await import('../../locales/vi.yml')).default,
  zh: async () => {
    const messages = (await import('../../locales/zh.yml')).default;
    if (import.meta.env.ELECTRON) {
      const desktop = (await import('../../locales/zh.desktop.yml')).default;
      return withDesktopMessages(messages, desktop);
    }
    return messages;
  },
};

const i18n = createI18n<false>({
  legacy: false,
  locale: 'en' as string,
  fallbackLocale: 'en',
  messages: {
    en: import.meta.env.ELECTRON
      ? withDesktopMessages(englishMessages, desktopEnglishMessages)
      : englishMessages,
    de: {},
    es: {},
    fr: {},
    no: {},
    pt: {},
    uk: {},
    vi: {},
    zh: {},
  },
});

const loadedLocales = new Set<SupportedLocale>(['en']);
const pendingLoads = new Map<SupportedLocale, Promise<void>>();
let latestLocaleRequest = 0;

// Share an in-flight load for each locale and register its messages before activation.
async function loadLocale(locale: SupportedLocale) {
  if (loadedLocales.has(locale)) {
    return;
  }

  const existingLoad = pendingLoads.get(locale);
  if (existingLoad) {
    await existingLoad;
    return;
  }

  const loader = localeLoaders[locale as Exclude<SupportedLocale, 'en'>];
  const load = loader()
    .then((messages) => {
      i18n.global.setLocaleMessage(locale, messages);
      loadedLocales.add(locale);
    })
    .finally(() => pendingLoads.delete(locale));
  pendingLoads.set(locale, load);
  await load;
}

function isSupportedLocale(value: string): value is SupportedLocale {
  return supportedLocaleCodes.includes(value as SupportedLocale);
}

/** Load translations before changing the active locale; the most recent selection wins. */
export async function activateLocale(value: string): Promise<SupportedLocale> {
  const requestId = ++latestLocaleRequest;
  const locale = isSupportedLocale(value) ? value : 'en';
  await loadLocale(locale);
  if (requestId === latestLocaleRequest) {
    i18n.global.locale.value = locale;
  }
  return locale;
}

export const i18nPlugin: Plugin = {
  install: (app) => {
    app.use(i18n);
  },
};

export const translate = function (localeKey: string) {
  const hasKey = i18n.global.te(localeKey, get(i18n.global.locale));
  return hasKey ? i18n.global.t(localeKey) : localeKey;
};
