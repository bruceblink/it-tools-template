import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import type { Tool } from '@/tools/tools.types';
import { scopeTool } from './tool-scope';

describe('sample extension tool metadata', () => {
  it('supplies reviewed governance metadata when production tool projections omit it', () => {
    const component = defineComponent({});
    const projectedSource: Tool = {
      name: 'Sample tool',
      path: '/sample-tool',
      translationKey: 'sample-tool',
      description: 'Sample tool description.',
      keywords: ['sample'],
      component: async () => component,
      icon: component,
      isNew: false,
    };

    const extensionTool = scopeTool('org.example.sample', 'sample-tool', projectedSource, {
      categoryId: 'development',
      platforms: ['web', 'electron'],
      dataProcessing: 'memory-only',
      offline: 'available',
      capabilities: [],
    });

    expect(extensionTool).toMatchObject({
      id: 'org.example.sample/sample-tool',
      categoryId: 'development',
      path: '/sample-tool',
      translationKey: 'sample-tool',
      platforms: ['web', 'electron'],
      dataProcessing: 'memory-only',
      offline: 'available',
      capabilities: [],
      extensionOwned: true,
    });
  });
});
