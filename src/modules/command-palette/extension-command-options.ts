import type { PaletteOption } from './command-palette.types';

export async function loadExtensionCommandOptions({
  locale,
  navigate,
  actionErrorMessage,
}: {
  locale: string
  navigate: (targetPath: string) => Promise<unknown>
  actionErrorMessage: string
}): Promise<PaletteOption[]> {
  const { extensionHost } = await import('@/extensions/runtime');
  const language = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';

  return extensionHost.getSearchableCommands().map((command) => {
    const labels = command.translations[language] ?? command.translations.en;
    return {
      name: labels.title,
      description: labels.description,
      category: language === 'zh' ? '第一方工具包' : 'First-party tools',
      keywords: [...command.keywords],
      closeOnSelect: true,
      actionErrorMessage,
      action: async () => {
        await extensionHost.executeCommand(command.pluginId, command.id, undefined);
        await navigate(command.targetPath);
      },
    };
  });
}
