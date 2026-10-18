import type { Component } from 'vue';
import { describe, expect, it } from 'vitest';
import { createValidatedToolRegistry } from './tool-registry';
import { defineTool } from './tool';
import type { Tool, ToolCategory } from './tools.types';

type ToolTestOverrides = Partial<Pick<Tool, 'id' | 'aliases' | 'redirectFrom' | 'categoryId' | 'platforms' | 'dataProcessing' | 'offline' | 'capabilities' | 'translationKey' | 'createdAt' | 'isNew'>>;

function createSampleTool(path: string, overrides: ToolTestOverrides = {}) {
  return defineTool({
    name: path,
    path,
    description: 'A registry test tool.',
    keywords: [],
    component: async () => ({} as Component),
    icon: {} as Component,
    ...overrides,
  });
}

function createCategory(components: ToolCategory['components']): ToolCategory[] {
  return [{ id: 'test-tools', name: 'Test tools', components }];
}

function createBuiltinRegistry(categories: ToolCategory[]) {
  return createValidatedToolRegistry(categories, 'builtin-compatibility');
}

describe('tool definition registry', () => {
  it('marks recent tools as new with a shared date threshold', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);

    expect(createSampleTool('/recent', { createdAt: recentDate }).isNew).toBe(true);
    expect(createSampleTool('/old', { createdAt: oldDate }).isNew).toBe(false);
    expect(createSampleTool('/pinned', { createdAt: recentDate, isNew: false }).isNew).toBe(false);
  });

  it('supplies stable legacy defaults and derives category views', () => {
    const legacyTool = createSampleTool('/sample', { redirectFrom: ['/legacy-sample'] });
    expect(legacyTool.id).toBeUndefined();

    const registry = createBuiltinRegistry(createCategory([
      legacyTool,
    ]));

    expect(registry.tools[0]).toMatchObject({
      id: 'builtin/sample',
      translationKey: 'sample',
      redirectFrom: ['/legacy-sample'],
    });
    expect(registry.tools).toHaveLength(1);
    expect(registry.tools[0]?.translationKey).toBe('sample');
    expect(registry.tools[0]?.platforms).toBeUndefined();
    expect(registry.toolsWithCategory[0]).toMatchObject({ categoryId: 'test-tools', category: 'Test tools' });
  });

  it('rejects duplicate tool IDs and route aliases', () => {
    const duplicateIds = createCategory([
      createSampleTool('/first'),
      createSampleTool('/second', { id: 'builtin/first' }),
    ]);
    expect(() => createBuiltinRegistry(duplicateIds)).toThrow('Duplicate tool id: builtin/first');

    const duplicateRoutes = createCategory([
      createSampleTool('/first', { aliases: ['/second'] }),
      createSampleTool('/second'),
    ]);
    expect(() => createBuiltinRegistry(duplicateRoutes)).toThrow(/Tool route conflict at \/second/);
  });

  it('rejects reserved paths and mismatched categories', () => {
    expect(() => createBuiltinRegistry(createCategory([createSampleTool('/about')]))).toThrow('cannot claim reserved route /about');
    expect(() => createBuiltinRegistry(createCategory([
      createSampleTool('/sample', { categoryId: 'different-category' }),
    ]))).toThrow('is listed under test-tools but declares different-category');
  });

  it('rejects unsupported platform and capability metadata at runtime', () => {
    expect(() => createBuiltinRegistry(createCategory([
      createSampleTool('/bad-platform', { platforms: ['ios'] as unknown as Tool['platforms'] }),
    ]))).toThrow('declares an unsupported platform');
    expect(() => createBuiltinRegistry(createCategory([
      createSampleTool('/bad-capability', { capabilities: ['system.shell'] as unknown as Tool['capabilities'] }),
    ]))).toThrow('requests an unknown capability');
  });

  it('requires explicit platform and permission metadata for extension definitions', () => {
    expect(() => createValidatedToolRegistry(createCategory([
      createSampleTool('/extension-tool', { id: 'sample:extension-tool' }),
    ]))).toThrow('must declare id, category, translation, platform, data, offline, and capability metadata');

    const registry = createValidatedToolRegistry(createCategory([
      createSampleTool('/extension-tool', {
        id: 'sample:extension-tool',
        categoryId: 'test-tools',
        platforms: ['web'],
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
      }),
    ]));
    expect(registry.tools[0]?.id).toBe('sample:extension-tool');
  });
});
