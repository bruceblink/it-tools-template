import type { Component } from 'vue';

type ComponentModule = { default: Component };
type ComponentLoader = () => Promise<ComponentModule>;

const sharedToolComponents = import.meta.glob<ComponentModule>([
  './*/**/*.vue',
  '!./api-client/**/*.vue',
  '!./container-workbench/**/*.vue',
  '!./database-manager/**/*.vue',
  '!./git-workbench/**/*.vue',
  '!./object-storage/**/*.vue',
  '!./system-monitor/**/*.vue',
]);

const desktopToolComponents = import.meta.glob<ComponentModule>([
  './api-client/**/*.vue',
  './container-workbench/**/*.vue',
  './database-manager/**/*.vue',
  './git-workbench/**/*.vue',
  './object-storage/**/*.vue',
  './system-monitor/**/*.vue',
]);

const componentLoaders: Record<string, ComponentLoader> = import.meta.env.ELECTRON
  ? { ...sharedToolComponents, ...desktopToolComponents }
  : sharedToolComponents;

/** Resolve one tool page on demand from the registry. */
export async function loadToolComponent(componentPath: string): Promise<Component> {
  const key = `./${componentPath.replace(/^\.\//, '')}`;
  const load = componentLoaders[key];
  if (!load) {
    throw new Error(`Unknown built-in tool component: ${componentPath}`);
  }
  return (await load()).default;
}
