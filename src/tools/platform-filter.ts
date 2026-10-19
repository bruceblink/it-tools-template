import type { ToolCategory, ToolPlatform } from './tools.types';

/** Keep legacy tools visible on both platforms unless they declare a narrower scope. */
export function filterToolCategoriesForPlatform<TCategory extends ToolCategory>(
  categories: readonly TCategory[],
  platform: ToolPlatform,
): TCategory[] {
  return categories.flatMap((category) => {
    const components = category.components.filter(tool => !tool.platforms || tool.platforms.includes(platform));
    return components.length > 0 ? [{ ...category, components } as TCategory] : [];
  });
}
