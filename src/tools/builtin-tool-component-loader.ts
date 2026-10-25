import type { Component } from 'vue';

/** Load the nested component registry only when a built-in tool route opens. */
export function loadBuiltinToolComponent(componentPath: string): Promise<Component> {
  return import('./builtin-tool-components').then(({ loadToolComponent }) => loadToolComponent(componentPath));
}
