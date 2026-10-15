// @vitest-environment node
// Registry checks read source locale files; they do not require a browser DOM.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { toolsByCategory } from './index';
import type { Tool } from './tools.types';

type LocaleMessages = {
  tools: Record<string, unknown> & {
    categories: Record<string, unknown>
  }
};

const locales = {
  en: parse(readFileSync(new URL('../../locales/en.yml', import.meta.url), 'utf8')) as LocaleMessages,
  zh: parse(readFileSync(new URL('../../locales/zh.yml', import.meta.url), 'utf8')) as LocaleMessages,
};

const registeredTools = toolsByCategory.flatMap(({ components }) => components);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRoute(path: string): string {
  return path.trim().replace(/\/+$/, '').toLowerCase() || '/';
}

const indexedTools = Object.values(import.meta.glob<Tool>('./*/index.ts', { eager: true, import: 'tool' }));

describe('tool registry integrity', () => {
  it('defines non-empty unique categories with at least one tool each', () => {
    const categoryNames = toolsByCategory.map(({ name }) => name.trim().toLowerCase());

    expect(toolsByCategory.length).toBeGreaterThan(0);
    expect(categoryNames.every(isNonEmptyString)).toBe(true);
    expect(new Set(categoryNames).size).toBe(categoryNames.length);
    expect(toolsByCategory.every(({ components }) => components.length > 0)).toBe(true);
  });

  it('uses unique non-empty tool names and defines each component and icon', () => {
    const normalizedNames = registeredTools.map(({ name }) => name.trim().toLowerCase());

    expect(registeredTools.length).toBeGreaterThan(0);
    expect(registeredTools.every(({ name }) => isNonEmptyString(name))).toBe(true);
    expect(new Set(normalizedNames).size).toBe(normalizedNames.length);
    expect(registeredTools.every(({ component }) => typeof component === 'function')).toBe(true);
    expect(registeredTools.every(({ icon }) => icon !== undefined && icon !== null)).toBe(true);
  });

  it('keeps tool paths and redirect aliases unique and away from reserved pages', () => {
    const routes = registeredTools.flatMap(({ path, redirectFrom = [] }) => [path, ...redirectFrom]);
    const normalizedRoutes = routes.map(normalizeRoute);

    expect(routes.every(path => isNonEmptyString(path) && path.startsWith('/'))).toBe(true);
    expect(new Set(normalizedRoutes).size).toBe(normalizedRoutes.length);
    expect(normalizedRoutes).not.toContain('/');
    expect(normalizedRoutes).not.toContain('/about');
  });

  it('registers every tool directory that defines an index.ts entry', () => {
    const indexedPaths = indexedTools.map(({ path }) => normalizeRoute(path)).sort();
    const registeredPaths = registeredTools.map(({ path }) => normalizeRoute(path)).sort();

    expect(new Set(indexedPaths).size).toBe(indexedPaths.length);
    expect(registeredPaths).toEqual(indexedPaths);
  });

  it.each(['en', 'zh'] as const)('provides complete %s tool and category translations', (locale) => {
    const messages = locales[locale].tools;

    for (const { name } of toolsByCategory) {
      const categoryLabel = messages.categories[name.toLowerCase()];
      expect(isNonEmptyString(categoryLabel), `${locale}: tools.categories.${name.toLowerCase()}`).toBe(true);
    }

    for (const { path } of registeredTools) {
      const translationKey = path.replace(/^\//, '');
      const toolMessages = messages[translationKey] as Record<string, unknown> | undefined;

      expect(isNonEmptyString(toolMessages?.title), `${locale}: tools.${translationKey}.title`).toBe(true);
      expect(isNonEmptyString(toolMessages?.description), `${locale}: tools.${translationKey}.description`).toBe(true);
    }
  });
});
