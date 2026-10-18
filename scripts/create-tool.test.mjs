import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createToolScaffold, parseCreateToolArguments } from './create-tool.mjs';

const validArguments = [
  'sample-tool',
  '--category', 'development',
  '--title-zh', '示例工具',
  '--data-processing', 'memory-only',
  '--offline', 'available',
  '--platforms', 'web,electron',
];

test('requires explicit tool placement and platform/data metadata', () => {
  const config = parseCreateToolArguments(validArguments);
  assert.equal(config.toolName, 'sample-tool');
  assert.equal(config.camelName, 'sampleTool');
  assert.equal(config.titleEn, 'Sample Tool');
  assert.deepEqual(config.platforms, ['web', 'electron']);
  assert.deepEqual(config.capabilities, []);

  assert.throws(() => parseCreateToolArguments(['../unsafe', ...validArguments.slice(1)]), /lowercase kebab-case/);
  assert.throws(() => parseCreateToolArguments(validArguments.filter(value => value !== 'development')), /--category/);
  assert.throws(() => parseCreateToolArguments([...validArguments, '--platforms', 'web']), /repeated value/);
  assert.throws(() => parseCreateToolArguments([...validArguments.slice(0, -1), 'web,desktop']), /Invalid platform list/);
});

test('creates a tool, registers its category, and adds both required translations', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'it-tools-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const toolsDir = path.join(root, 'src', 'tools');
  const localeDir = path.join(root, 'locales');
  await mkdir(toolsDir, { recursive: true });
  await mkdir(localeDir, { recursive: true });
  const registryPath = path.join(toolsDir, 'index.ts');
  const englishLocalePath = path.join(localeDir, 'en.yml');
  const chineseLocalePath = path.join(localeDir, 'zh.yml');
  await writeFile(registryPath, [
    "import type { ToolCategory, ToolWithCategory } from './tools.types';",
    'const declaredToolCategories: ToolCategory[] = [',
    '  {',
    "    id: 'development',",
    "    name: 'Development',",
    '    components: [',
    '      existingTool,',
    '    ],',
    '  },',
    '];',
    '',
  ].join('\n'), 'utf8');
  await writeFile(englishLocalePath, [
    'home:', '  title: Home', 'tools:', '  categories:', '    development: Development',
    '  existing-tool:', '    title: Existing tool', '    description: Existing description', '',
  ].join('\n'), 'utf8');
  await writeFile(chineseLocalePath, [
    'home:', '  title: 首页', 'tools:', '  categories:', '    development: 开发',
    '  existing-tool:', '    title: 现有工具', '    description: 现有说明', '',
  ].join('\n'), 'utf8');

  const config = parseCreateToolArguments(validArguments);
  const result = await createToolScaffold(config, { toolsDir, registryPath, englishLocalePath, chineseLocalePath });
  const registeredSource = await readFile(registryPath, 'utf8');
  const english = await readFile(englishLocalePath, 'utf8');
  const chinese = await readFile(chineseLocalePath, 'utf8');
  const generatedDefinition = await readFile(path.join(result.targetDirectory, 'index.ts'), 'utf8');
  const generatedTest = await readFile(path.join(result.targetDirectory, 'sample-tool.test.ts'), 'utf8');
  const generatedE2e = await readFile(path.join(result.targetDirectory, 'sample-tool.e2e.spec.ts'), 'utf8');

  assert.match(registeredSource, /import \{ tool as sampleTool \} from '\.\/sample-tool';/);
  assert.match(registeredSource, /components: \[\s+existingTool,\s+sampleTool\s+\]/);
  assert.match(generatedDefinition, /id: 'builtin\/sample-tool'/);
  assert.match(generatedDefinition, /\} satisfies ToolDefinition;/);
  assert.match(generatedDefinition, /dataProcessing: 'memory-only'/);
  assert.match(generatedDefinition, /capabilities: \[\]/);
  assert.match(generatedTest, /createValidatedToolRegistry\(categories, 'extension'\)/);
  assert.match(generatedE2e, /toHaveText\('TODO: Replace this scaffold with the tool description\.'\)/);
  assert.match(english, /sample-tool:\n    title: "Sample Tool"\n    description: "TODO: Replace this scaffold with the tool description\."/);
  assert.match(chinese, /sample-tool:\n    title: "示例工具"\n    description: "待补充：请替换为此工具的用途说明。"/);
  assert.deepEqual(result.files.sort(), ['index.ts', 'sample-tool.e2e.spec.ts', 'sample-tool.test.ts', 'sample-tool.vue'].sort());
});

test('rejects an unknown category and leaves the tool directory untouched', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'it-tools-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const toolsDir = path.join(root, 'src', 'tools');
  const localeDir = path.join(root, 'locales');
  await mkdir(toolsDir, { recursive: true });
  await mkdir(localeDir, { recursive: true });
  const registryPath = path.join(toolsDir, 'index.ts');
  const englishLocalePath = path.join(localeDir, 'en.yml');
  const chineseLocalePath = path.join(localeDir, 'zh.yml');
  await writeFile(registryPath, ["import type { ToolCategory, ToolWithCategory } from './tools.types';", 'const declaredToolCategories = [];', ''].join('\n'), 'utf8');
  await writeFile(englishLocalePath, ['tools:', '  categories:', '    development: Development', ''].join('\n'), 'utf8');
  await writeFile(chineseLocalePath, ['tools:', '  categories:', '    development: 开发', ''].join('\n'), 'utf8');

  const config = parseCreateToolArguments(validArguments);
  await assert.rejects(
    createToolScaffold(config, { toolsDir, registryPath, englishLocalePath, chineseLocalePath }),
    /Expected one tool category/,
  );
  await assert.rejects(readFile(path.join(toolsDir, 'sample-tool', 'index.ts'), 'utf8'), { code: 'ENOENT' });
});
