import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirname, '..');
const toolsDir = join(repositoryRoot, 'src', 'tools');
const registryPath = join(toolsDir, 'index.ts');
const englishLocalePath = join(repositoryRoot, 'locales', 'en.yml');
const chineseLocalePath = join(repositoryRoot, 'locales', 'zh.yml');

const dataProcessingPolicies = new Set(['memory-only', 'local-data', 'user-selected-files', 'network', 'unspecified']);
const offlineSupportLevels = new Set(['available', 'requires-network', 'conditional', 'unknown']);
const supportedPlatforms = new Set(['web', 'electron']);
const knownCapabilities = new Set(['clipboard.write', 'file.read', 'file.save', 'device.camera', 'runtime.info', 'data.oui']);

function usageError(message) {
  return new Error(`${message}\nUsage: pnpm script:create:tool <tool-name> --category <category-id> --title-zh <title> --data-processing <policy> --offline <level> --platforms <web,electron> [--capabilities <capability,...>]`);
}

function parseList(value, label, allowedValues) {
  const values = value.split(',').map(item => item.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length || values.some(item => !allowedValues.has(item))) {
    throw usageError(`Invalid ${label}: ${value}`);
  }
  return values;
}

/** Parse a validated tool slug and the metadata that the scaffold cannot infer safely. */
export function parseCreateToolArguments(argv) {
  const [toolName, ...options] = argv;
  if (!toolName || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(toolName)) {
    throw usageError('Tool name must use lowercase kebab-case and start with a letter.');
  }

  const values = new Map();
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (!option.startsWith('--')) {
      throw usageError(`Unexpected argument: ${option}`);
    }
    const separatorIndex = option.indexOf('=');
    const name = option.slice(2, separatorIndex < 0 ? undefined : separatorIndex);
    const value = separatorIndex >= 0 ? option.slice(separatorIndex + 1) : options[++index];
    if (!['category', 'title-zh', 'title-en', 'data-processing', 'offline', 'platforms', 'capabilities'].includes(name)) {
      throw usageError(`Unknown option: --${name}`);
    }
    if (values.has(name) || !value || value.startsWith('--')) {
      throw usageError(`Missing or repeated value for --${name}.`);
    }
    values.set(name, value);
  }

  const categoryId = values.get('category');
  const titleZh = values.get('title-zh');
  const dataProcessing = values.get('data-processing');
  const offline = values.get('offline');
  const platformValue = values.get('platforms');
  if (!categoryId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categoryId)) {
    throw usageError('A valid --category value is required.');
  }
  if (!titleZh?.trim()) {
    throw usageError('A non-empty --title-zh value is required.');
  }
  if (!dataProcessingPolicies.has(dataProcessing)) {
    throw usageError(`A valid --data-processing value is required: ${[...dataProcessingPolicies].join(', ')}.`);
  }
  if (!offlineSupportLevels.has(offline)) {
    throw usageError(`A valid --offline value is required: ${[...offlineSupportLevels].join(', ')}.`);
  }
  if (!platformValue) {
    throw usageError('A --platforms value is required.');
  }

  const titleEn = values.get('title-en')?.trim() || toolName.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  const capabilities = values.has('capabilities') && values.get('capabilities') !== 'none'
    ? parseList(values.get('capabilities'), 'capability list', knownCapabilities)
    : [];

  return {
    toolName,
    camelName: toolName.replace(/-([a-z0-9])/g, (_match, letter) => letter.toUpperCase()),
    categoryId,
    titleEn,
    titleZh: titleZh.trim(),
    dataProcessing,
    offline,
    platforms: parseList(platformValue, 'platform list', supportedPlatforms),
    capabilities,
  };
}

function findClosingBracket(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    if (source[index] === '[') {
      depth++;
    }
    else if (source[index] === ']') {
      depth--;
      if (depth === 0) {
        return index;
      }
      if (depth < 0) {
        break;
      }
    }
  }
  throw new Error('Could not find the end of the tool category component list.');
}

function addToolToCategory(source, categoryId, toolName, camelName) {
  const categoryPattern = new RegExp(`^\\s*id: '${categoryId}',?\\s*$`, 'gm');
  const categoryMatches = [...source.matchAll(categoryPattern)];
  if (categoryMatches.length !== 1) {
    throw new Error(`Expected one tool category with id "${categoryId}" in src/tools/index.ts.`);
  }

  const categoryStart = categoryMatches[0].index;
  const nextCategory = source.indexOf("\n    id: '", categoryStart + categoryMatches[0][0].length);
  const categoryEnd = nextCategory < 0 ? source.length : categoryStart + nextCategory;
  const componentsToken = 'components: [';
  const componentsStart = source.indexOf(componentsToken, categoryStart);
  if (componentsStart < 0 || componentsStart >= categoryEnd) {
    throw new Error(`Category "${categoryId}" has no components array.`);
  }

  const openIndex = componentsStart + componentsToken.length - 1;
  const closeIndex = findClosingBracket(source, openIndex);
  const entries = source.slice(openIndex + 1, closeIndex);
  if (new RegExp(`\\b${camelName}\\b`).test(entries)) {
    throw new Error(`Tool import "${camelName}" is already registered in category "${categoryId}".`);
  }
  if (entries.includes('[')) {
    throw new Error(`Category "${categoryId}" uses an unsupported nested components array.`);
  }

  const body = entries.replace(/\s*$/, '');
  const trailingWhitespace = entries.slice(body.length);
  const isMultiline = entries.includes('\n');
  const entryIndent = source.slice(source.lastIndexOf('\n', openIndex) + 1, openIndex).match(/^\s*/)?.[0] + '  ';
  let updatedEntries;
  if (isMultiline) {
    const previousIndent = entries.match(/\n([ \t]+)[A-Za-z_$]/)?.[1] ?? entryIndent;
    const separator = body && !body.trimEnd().endsWith(',') ? ',' : '';
    const closingIndent = source.slice(source.lastIndexOf('\n', closeIndex) + 1, closeIndex).match(/^\s*/)?.[0] ?? '';
    updatedEntries = `${body}${separator}\n${previousIndent}${camelName}\n${closingIndent}`;
  }
  else {
    const separator = body.trim() ? (body.trimEnd().endsWith(',') ? ' ' : ', ') : ' ';
    updatedEntries = `${body}${separator}${camelName}${trailingWhitespace}`;
  }

  const updatedSource = `${source.slice(0, openIndex + 1)}${updatedEntries}${source.slice(closeIndex)}`;
  if (updatedSource.includes(`from './${toolName}'`)) {
    throw new Error(`Tool import "${camelName}" already exists in src/tools/index.ts.`);
  }
  const typeImport = "import type { ToolCategory, ToolWithCategory } from './tools.types';";
  if (!updatedSource.includes(typeImport)) {
    throw new Error('Could not find the tool import insertion point in src/tools/index.ts.');
  }
  return updatedSource.replace(typeImport, `import { tool as ${camelName} } from './${toolName}';\n${typeImport}`);
}

function addToolTranslation(source, toolName, title, description) {
  const lines = source.split(/\r?\n/);
  const toolsIndex = lines.findIndex(line => line === 'tools:');
  if (toolsIndex < 0) {
    throw new Error('Could not find the tools section in the locale file.');
  }
  const sectionEnd = lines.findIndex((line, index) => index > toolsIndex && line.length > 0 && !/^\s/.test(line));
  const end = sectionEnd < 0 ? lines.length : sectionEnd;
  const existingTool = lines.slice(toolsIndex + 1, end).some(line => line === `  ${toolName}:`);
  if (existingTool) {
    throw new Error(`Translation key "tools.${toolName}" already exists.`);
  }

  const firstToolIndex = lines.findIndex((line, index) => index > toolsIndex && index < end && /^  [a-z0-9][a-z0-9-]*:$/.test(line) && line !== '  categories:');
  const insertionIndex = firstToolIndex < 0 ? end : firstToolIndex;
  const block = [
    `  ${toolName}:`,
    `    title: ${JSON.stringify(title)}`,
    `    description: ${JSON.stringify(description)}`,
    '',
  ];
  lines.splice(insertionIndex, 0, ...block);
  return lines.join('\n');
}

function buildToolFiles(config) {
  const { toolName, camelName, categoryId, titleEn, dataProcessing, offline, platforms, capabilities } = config;
  const keywords = toolName.split('-').map(value => JSON.stringify(value)).join(', ');
  const platformSource = platforms.map(value => JSON.stringify(value)).join(', ');
  const capabilitySource = capabilities.map(value => JSON.stringify(value)).join(', ');

  return new Map([
    [`${toolName}.vue`, `<template>
  <c-card :title="$t('tools.${toolName}.title')">
    <p data-test-id="tool-scaffold">{{ $t('tools.${toolName}.description') }}</p>
  </c-card>
</template>
`],
    ['index.ts', `import { ArrowsShuffle } from '@vicons/tabler';
import { defineTool } from '../tool';
import type { ToolDefinition } from '../tools.types';
import { translate } from '@/plugins/i18n.plugin';

const toolDefinition = {
  id: 'builtin/${toolName}',
  categoryId: '${categoryId}',
  translationKey: '${toolName}',
  name: translate('tools.${toolName}.title'),
  path: '/${toolName}',
  description: translate('tools.${toolName}.description'),
  keywords: [${keywords}],
  component: () => import('./${toolName}.vue'),
  icon: ArrowsShuffle,
  platforms: [${platformSource}],
  dataProcessing: '${dataProcessing}',
  offline: '${offline}',
  capabilities: [${capabilitySource}],
  createdAt: new Date('${new Date().toISOString().slice(0, 10)}'),
} satisfies ToolDefinition;

export const tool = defineTool(toolDefinition);
export { toolDefinition };
`],
    [`${toolName}.test.ts`, `import { describe, expect, it } from 'vitest';
import { createValidatedToolRegistry } from '../tool-registry';
import type { ToolCategory } from '../tools.types';
import { tool } from './index';

describe('${toolName} tool definition', () => {
  it('declares explicit metadata and registers under its category', () => {
    const categories: ToolCategory[] = [{ id: '${categoryId}', name: '${categoryId}', components: [tool] }];
    const registry = createValidatedToolRegistry(categories, 'extension');

    expect(registry.tools).toHaveLength(1);
    expect(registry.tools[0]).toMatchObject({
      id: 'builtin/${toolName}',
      categoryId: '${categoryId}',
      translationKey: '${toolName}',
      path: '/${toolName}',
      platforms: [${platformSource}],
      dataProcessing: '${dataProcessing}',
      offline: '${offline}',
      capabilities: [${capabilitySource}],
    });
  });
});
`],
    [`${toolName}.e2e.spec.ts`, `import { expect, test } from '@playwright/test';

test.describe('Tool - ${titleEn}', () => {
  test('opens the generated tool page and renders its translated scaffold', async ({ page }) => {
    await page.goto('/${toolName}');

    await expect(page.getByTestId('tool-scaffold')).toHaveText('TODO: Replace this scaffold with the tool description.');
  });
});
`],
  ]);
}

function getCamelName(toolName) {
  return toolName.replace(/-([a-z0-9])/g, (_match, letter) => letter.toUpperCase());
}

/** Generate a tool, register it with its category, and add English and Chinese translations. */
export async function createToolScaffold(config, paths = {}) {
  config = parseCreateToolArguments([
    config.toolName,
    '--category', config.categoryId,
    '--title-en', config.titleEn,
    '--title-zh', config.titleZh,
    '--data-processing', config.dataProcessing,
    '--offline', config.offline,
    '--platforms', (config.platforms ?? []).join(','),
    ...((config.capabilities ?? []).length > 0 ? ['--capabilities', config.capabilities.join(',')] : []),
  ]);
  const targetToolsDir = paths.toolsDir ?? toolsDir;
  const targetRegistryPath = paths.registryPath ?? join(targetToolsDir, 'index.ts');
  const targetEnglishPath = paths.englishLocalePath ?? englishLocalePath;
  const targetChinesePath = paths.chineseLocalePath ?? chineseLocalePath;
  const targetDirectory = join(targetToolsDir, config.toolName);

  const [registry, englishLocale, chineseLocale] = await Promise.all([
    readFile(targetRegistryPath, 'utf8'),
    readFile(targetEnglishPath, 'utf8'),
    readFile(targetChinesePath, 'utf8'),
  ]);
  const registered = addToolToCategory(registry, config.categoryId, config.toolName, config.camelName);
  const english = addToolTranslation(englishLocale, config.toolName, config.titleEn, 'TODO: Replace this scaffold with the tool description.');
  const chinese = addToolTranslation(chineseLocale, config.toolName, config.titleZh, '待补充：请替换为此工具的用途说明。');
  const files = buildToolFiles(config);

  await mkdir(targetDirectory);
  try {
    await Promise.all([...files].map(([name, content]) => writeFile(join(targetDirectory, name), content, { encoding: 'utf8', flag: 'wx' })));
    await Promise.all([
      writeFile(targetRegistryPath, registered, 'utf8'),
      writeFile(targetEnglishPath, english, 'utf8'),
      writeFile(targetChinesePath, chinese, 'utf8'),
    ]);
  }
  catch (error) {
    throw new Error(`Tool scaffold was not fully written under ${targetDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { targetDirectory, files: [...files.keys()] };
}

async function main(argv) {
  const config = parseCreateToolArguments(argv);
  const result = await createToolScaffold(config);
  console.log(`Created tool scaffold: ${result.targetDirectory}`);
  console.log(`Registered ${config.camelName} in category "${config.categoryId}" and added English and Chinese translations.`);
  console.log('Review platform, data, offline, and capability metadata before implementing the tool.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
