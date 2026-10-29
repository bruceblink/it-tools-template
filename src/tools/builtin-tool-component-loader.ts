import type { Component } from 'vue';
import { loadToolComponent } from './builtin-tool-components';

/** Resolve a built-in tool directly from the in-memory loader registry. */
export function loadBuiltinToolComponent(componentPath: string): Promise<Component> {
  return loadToolComponent(componentPath);
}
