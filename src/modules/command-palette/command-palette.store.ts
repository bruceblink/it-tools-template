import { defineStore } from 'pinia';
import type { PaletteOption } from './command-palette.types';
import { useToolStore } from '@/tools/tools.store';
import { useFuzzySearch } from '@/composable/fuzzySearch';
import { useStyleStore } from '@/stores/style.store';

import SunIcon from '~icons/mdi/white-balance-sunny';
import GithubIcon from '~icons/mdi/github';
import BugIcon from '~icons/mdi/bug-outline';
import DiceIcon from '~icons/mdi/dice-5';
import InfoIcon from '~icons/mdi/information-outline';
import { config } from '@/config';

export const useCommandPaletteStore = defineStore('command-palette', () => {
  const toolStore = useToolStore();
  const styleStore = useStyleStore();
  const router = useRouter();
  const { locale, t } = useI18n();
  const searchPrompt = ref('');
  const repositoryUrl = config.app.repositoryUrl;

  const toolsOptions = toolStore.tools.map(tool => ({
    ...tool,
    to: tool.path,
    toolCategory: tool.category,
    category: 'Tools',
  }));

  const builtInSearchOptions: PaletteOption[] = [
    ...toolsOptions,
    {
      name: 'Random tool',
      description: 'Get a random tool from the list.',
      action: () => {
        const tool = toolStore.tools[Math.floor(Math.random() * toolStore.tools.length)];
        if (!tool) {
          return;
        }
        const { path } = tool;
        router.push(path);
      },
      icon: DiceIcon,
      category: 'Tools',
      keywords: ['random', 'tool', 'pick', 'choose', 'select'],
      closeOnSelect: true,
    },
    {
      name: 'Toggle dark mode',
      description: 'Toggle dark mode on or off.',
      action: () => styleStore.toggleDark(),
      icon: SunIcon,
      category: 'Actions',
      keywords: ['dark', 'theme', 'toggle', 'mode', 'light', 'system'],
    },
    {
      name: 'Github repository',
      href: `${repositoryUrl}`,
      category: 'External',
      description: 'View the source code of it-tools on Github.',
      keywords: ['github', 'repo', 'repository', 'source', 'code'],
      icon: GithubIcon,
    },
    {
      name: 'Report a bug or an issue',
      description: 'Report a bug or an issue to help improve it-tools.',
      href: `${repositoryUrl}/issues/new/choose`,
      category: 'Actions',
      keywords: ['report', 'issue', 'bug', 'problem', 'error'],
      icon: BugIcon,
    },
    {
      name: 'About',
      description: 'Learn more about IT-Tools.',
      to: '/about',
      category: 'Pages',
      keywords: ['about', 'learn', 'more', 'info', 'information'],
      icon: InfoIcon,
    },
  ];
  const searchOptions = ref<PaletteOption[]>(builtInSearchOptions);
  let extensionCommandLoad: Promise<void> | undefined;
  let extensionCommandLoadLocale: string | undefined;
  let loadedExtensionCommandLocale: string | undefined;
  let latestExtensionCommandRequest: symbol | undefined;

  function loadExtensionCommands(): Promise<void> {
    const requestLocale = locale.value;
    if (
      extensionCommandLoad
      && (extensionCommandLoadLocale === requestLocale || loadedExtensionCommandLocale === requestLocale)
    ) {
      return extensionCommandLoad;
    }

    const requestId = Symbol(requestLocale);
    latestExtensionCommandRequest = requestId;
    extensionCommandLoadLocale = requestLocale;
    extensionCommandLoad = import('./extension-command-options')
      .then(({ loadExtensionCommandOptions }) => loadExtensionCommandOptions({
        locale: requestLocale,
        navigate: targetPath => router.push(targetPath),
        actionErrorMessage: t('taskStatus.error'),
      }))
      .then((extensionCommands) => {
        if (latestExtensionCommandRequest !== requestId) {
          return;
        }
        searchOptions.value = [...builtInSearchOptions, ...extensionCommands];
        loadedExtensionCommandLocale = requestLocale;
        extensionCommandLoadLocale = undefined;
      })
      .catch((error: unknown) => {
        if (latestExtensionCommandRequest === requestId) {
          extensionCommandLoad = undefined;
          extensionCommandLoadLocale = undefined;
        }
        throw error;
      });
    return extensionCommandLoad;
  }

  const { searchResult } = useFuzzySearch({
    search: searchPrompt,
    data: searchOptions,
    options: {
      keys: [{ name: 'name', weight: 2 }, 'description', 'keywords', 'category'],
      threshold: 0.3,
    },
  });

  const filteredSearchResult = computed(() => {
    const grouped = new Map<string, PaletteOption[]>();
    for (const option of searchResult.value) {
      const category = grouped.get(option.category) ?? [];
      if (category.length < 5) {
        category.push(option);
        grouped.set(option.category, category);
      }
    }
    return Object.fromEntries(grouped);
  });

  return {
    filteredSearchResult,
    loadExtensionCommands,
    searchPrompt,
  };
});
