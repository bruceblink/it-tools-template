import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';
import { filterToolCategoriesForPlatform } from './platform-filter';
import type { Tool, ToolCategory } from './tools.types';

function createTool(path: string, platforms?: Tool['platforms']): Tool {
  return {
    name: path,
    path,
    translationKey: path.replace(/^\//, ''),
    description: path,
    keywords: [],
    component: async () => defineComponent({}),
    icon: defineComponent({}),
    ...(platforms ? { platforms } : {}),
    isNew: false,
  };
}

describe('filterToolCategoriesForPlatform', () => {
  const categories: ToolCategory[] = [
    {
      id: 'shared',
      name: 'Shared',
      components: [
        createTool('/both', ['web', 'electron']),
        createTool('/web', ['web']),
        createTool('/legacy'),
      ],
    },
    { id: 'desktop', name: 'Desktop', components: [createTool('/desktop', ['electron'])] },
  ];

  it('keeps dual-platform and legacy tools on the web while excluding desktop-only tools', () => {
    const paths = filterToolCategoriesForPlatform(categories, 'web')
      .flatMap(category => category.components.map(tool => tool.path));

    expect(paths).toEqual(['/both', '/web', '/legacy']);
  });

  it('keeps dual-platform and desktop-only tools on Electron while excluding web-only tools', () => {
    const paths = filterToolCategoriesForPlatform(categories, 'electron')
      .flatMap(category => category.components.map(tool => tool.path));

    expect(paths).toEqual(['/both', '/legacy', '/desktop']);
  });

  it('removes categories that have no tools on the requested platform', () => {
    const desktopOnly: ToolCategory[] = [{ id: 'desktop', name: 'Desktop', components: [createTool('/desktop', ['electron'])] }];

    expect(filterToolCategoriesForPlatform(desktopOnly, 'web')).toEqual([]);
  });
});
