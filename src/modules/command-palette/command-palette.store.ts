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
import { Puzzle } from '@vicons/tabler';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';

export const useCommandPaletteStore = defineStore('command-palette', () => {
  const toolStore = useToolStore();
  const styleStore = useStyleStore();
  const router = useRouter();
  const { locale, t } = useI18n();
  const searchPrompt = ref('');
  const repositoryUrl = config.app.repositoryUrl;

  const toolsOptions = computed<PaletteOption[]>(() => toolStore.tools.map(tool => ({
    ...tool,
    to: tool.path,
    toolCategory: tool.category,
    category: 'Tools',
  })));

  const externalPluginV2Options = computed<PaletteOption[]>(() => externalPluginV2Registry.commands.value.map(command => ({
    name: command.title,
    description: command.description,
    icon: Puzzle,
    category: locale.value.toLowerCase().startsWith('zh') ? '插件工具' : 'Plugin tools',
    keywords: [...command.keywords],
    closeOnSelect: true,
    actionErrorMessage: t('taskStatus.error'),
    action: async () => {
      if (command.targetPath) {
        await router.push(command.targetPath);
        return;
      }
      await command.execute({
        pluginId: command.pluginId,
        version: command.version,
        toolId: command.toolId ?? command.id,
        commandId: command.id,
        input: {},
      }, new AbortController().signal);
    },
  })));

  const builtInSearchOptions: PaletteOption[] = [
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
  const extensionSearchOptions = ref<PaletteOption[]>([]);
  const searchOptions = computed<PaletteOption[]>(() => [
    ...toolsOptions.value,
    ...externalPluginV2Options.value,
    ...builtInSearchOptions,
    ...extensionSearchOptions.value,
  ]);
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
        extensionSearchOptions.value = extensionCommands;
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
