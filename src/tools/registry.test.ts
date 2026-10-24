// @vitest-environment node
// Registry checks read source locale files; they do not require a browser DOM.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { firstPartyExtensionToolCategories } from '@/extensions/samples/tool-definitions';
import { toolDefinitions, tools, toolsByCategory, toolsWithCategory } from './index';
import { filterToolCategoriesForPlatform } from './platform-filter';
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

const indexedTools = Object.values(import.meta.glob<Tool>('./*/index.ts', { eager: true, import: 'tool' }));
const registeredTools = indexedTools;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRoute(path: string): string {
  return path.trim().replace(/\/+$/, '').toLowerCase() || '/';
}

describe('tool registry integrity', () => {
  it('defines non-empty unique categories with at least one tool each', () => {
    const categoryNames = toolsByCategory.map(({ name }) => name.trim().toLowerCase());
    const categoryIds = toolsByCategory.map(({ id }) => id);

    expect(toolsByCategory.length).toBeGreaterThan(0);
    expect(categoryNames.every(isNonEmptyString)).toBe(true);
    expect(categoryIds.every(isNonEmptyString)).toBe(true);
    expect(new Set(categoryNames).size).toBe(categoryNames.length);
    expect(new Set(categoryIds).size).toBe(categoryIds.length);
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
    const routes = registeredTools.flatMap(({ path, aliases, redirectFrom }) => [path, ...(aliases ?? redirectFrom ?? [])]);
    const normalizedRoutes = routes.map(normalizeRoute);
    const generatedRedirects = tools.flatMap(({ path, aliases, redirectFrom }) =>
      (aliases ?? redirectFrom ?? []).map(alias => ({ path: alias, redirect: path })),
    );
    const declaredRedirects = registeredTools
      .filter(({ platforms }) => !platforms || platforms.includes('web'))
      .flatMap(({ path, aliases, redirectFrom }) =>
      (aliases ?? redirectFrom ?? []).map(alias => ({ path: alias, redirect: path })),
      );

    expect(routes.every(path => isNonEmptyString(path) && path.startsWith('/'))).toBe(true);
    expect(new Set(normalizedRoutes).size).toBe(normalizedRoutes.length);
    expect(normalizedRoutes).not.toContain('/');
    expect(normalizedRoutes).not.toContain('/about');
    expect(generatedRedirects.sort((left, right) => left.path.localeCompare(right.path)))
      .toEqual(declaredRedirects.sort((left, right) => left.path.localeCompare(right.path)));
  });

  it('registers every tool directory that defines an index.ts entry', () => {
    const indexedPaths = indexedTools.map(({ path }) => normalizeRoute(path)).sort();
    const registeredPaths = registeredTools.map(({ path }) => normalizeRoute(path)).sort();

    expect(registeredTools).toHaveLength(121);
    expect(new Set(indexedPaths).size).toBe(indexedPaths.length);
    expect(registeredPaths).toEqual(indexedPaths);
    const registeredExtensionTools = registeredTools.filter(({ extensionOwned }) => extensionOwned);
    expect(registeredExtensionTools).toHaveLength(9);
    const extensionDefinitions = firstPartyExtensionToolCategories.flatMap(({ components }) => components);
    expect(extensionDefinitions).toHaveLength(9);
    expect(extensionDefinitions.every(({ extensionOwned }) => extensionOwned)).toBe(true);
    expect(extensionDefinitions.map(({ path }) => path).sort()).toEqual(registeredExtensionTools.map(({ path }) => path).sort());
  });

  it('keeps the registry and navigation definitions aligned', () => {
    const toolPaths = tools.map(({ path }) => normalizeRoute(path)).sort();
    const toolTranslationKeys = tools.map(({ translationKey }) => translationKey).sort();
    const navigationPaths = toolsWithCategory.map(({ path }) => normalizeRoute(path)).sort();
    const indexedRegistryPaths = filterToolCategoriesForPlatform(
      [{ id: 'all-tools', name: 'All tools', components: registeredTools }],
      'web',
    )
      .flatMap(({ components }) => components.map(({ path }) => normalizeRoute(path)))
      .sort();
    const indexedTranslationKeys = filterToolCategoriesForPlatform(
      [{ id: 'all-tools', name: 'All tools', components: registeredTools }],
      'web',
    )
      .flatMap(({ components }) => components.map(({ translationKey }) => translationKey))
      .sort();

    expect(navigationPaths).toEqual(toolPaths);
    expect(indexedRegistryPaths).toEqual(toolPaths);
    expect(indexedTranslationKeys).toEqual(toolTranslationKeys);
    expect(toolsWithCategory.every(({ translationKey, categoryId, platforms, offline, dataProcessing }) =>
      isNonEmptyString(translationKey)
      && isNonEmptyString(categoryId)
      && (!platforms || platforms.length > 0)
      && (!offline || isNonEmptyString(offline))
      && (!dataProcessing || isNonEmptyString(dataProcessing)),
    )).toBe(true);

    for (const id of [
      'builtin/json-lines-converter',
      'builtin/html-wysiwyg-editor',
      'builtin/mac-address-lookup',
    ]) {
      const definition = toolDefinitions.flatMap(({ components }) => components).find(tool => tool.id === id);
      expect(definition?.platforms, id).toBeDefined();
      expect(definition?.dataProcessing, id).toBeDefined();
      expect(definition?.offline, id).toBeDefined();
      expect(definition?.capabilities, id).toBeDefined();
    }

    for (const path of ['/database-manager', '/system-monitor', '/api-client', '/git-workbench']) {
      const definition = registeredTools.find(tool => tool.path === path);
      expect(definition?.platforms, path).toEqual(['electron']);
      expect(definition?.contentWidth, path).toBe('wide');
    }
  });

  it.each(['en', 'zh'] as const)('provides complete %s tool and category translations', (locale) => {
    const messages = locales[locale].tools;

    for (const { id } of toolsByCategory) {
      const categoryLabel = messages.categories[id];
      expect(isNonEmptyString(categoryLabel), `${locale}: tools.categories.${id}`).toBe(true);
    }

    for (const { translationKey } of registeredTools) {
      const toolMessages = messages[translationKey] as Record<string, unknown> | undefined;

      expect(isNonEmptyString(toolMessages?.title), `${locale}: tools.${translationKey}.title`).toBe(true);
      expect(isNonEmptyString(toolMessages?.description), `${locale}: tools.${translationKey}.description`).toBe(true);
    }
  });
});
