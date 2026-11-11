import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const defaultPluginsDirectory = join(repositoryRoot, 'plugins');
const sdkV2Directory = join(repositoryRoot, 'plugins', 'sdk-v2');
const sdkV2TypeFiles = [
  'it-tools-plugin-v2.d.ts',
  'plugin-v2-json.d.ts',
  'plugin-v2-manifest.d.ts',
  'plugin-v2-package.d.ts',
  'plugin-v2-wasm.d.ts',
];
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const pluginToolIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const categoryIdPattern = /^[a-z][a-z0-9-]{0,63}$/;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function usageError(message) {
  return new Error(`${message}\nUsage: pnpm plugin:create:v2 -- --id <plugin-id> --name <display-name> [--directory <path>] [--version <semver>] [--tool-id <slug>] [--tool-title <title>] [--description <text>] [--category-id <slug>] [--output-kind text|table] [--capability runtime.info]`);
}

function parseOptionValues(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option?.startsWith('--')) {
      throw usageError(`Unexpected argument: ${option ?? ''}`);
    }
    const separator = option.indexOf('=');
    const name = option.slice(2, separator < 0 ? undefined : separator);
    const value = separator < 0 ? argv[index + 1] : option.slice(separator + 1);
    if (!['id', 'name', 'directory', 'version', 'tool-id', 'tool-title', 'description', 'category-id', 'output-kind', 'capability'].includes(name)) {
      throw usageError(`Unknown option: --${name}`);
    }
    if (!value || value.startsWith('--') || values.has(name)) {
      throw usageError(`Missing or repeated value for --${name}.`);
    }
    values.set(name, value);
    if (separator < 0) {
      index += 1;
    }
  }
  return values;
}

/** 解析 v2 脚手架参数，生成无能力、可由宿主统一渲染的工具。 */
export function parseCreatePluginV2Arguments(argv) {
  const values = parseOptionValues(argv);
  const id = values.get('id');
  const name = values.get('name')?.trim();
  const version = values.get('version') ?? '0.1.0';
  const toolId = values.get('tool-id') ?? 'tool';
  const toolTitle = values.get('tool-title')?.trim() ?? name;
  const description = values.get('description')?.trim() ?? 'A starting point for an IT Tools v2 plugin.';
  const categoryId = values.get('category-id') ?? 'development';
  const outputKind = values.get('output-kind') ?? 'text';
  const capability = values.get('capability') ?? 'none';
  if (!id || !pluginIdPattern.test(id) || id.length > 128) {
    throw usageError('Plugin ID must use lowercase dot or dash separated segments and be at most 128 characters.');
  }
  if (!name || name.length > 120) {
    throw usageError('Plugin name must be non-empty and at most 120 characters.');
  }
  if (!stableVersionPattern.test(version)) {
    throw usageError('Plugin version must use MAJOR.MINOR.PATCH format.');
  }
  if (!pluginToolIdPattern.test(toolId) || toolId.length > 128) {
    throw usageError('Tool ID must use lowercase kebab-case and be at most 128 characters.');
  }
  if (!toolTitle || toolTitle.length > 120) {
    throw usageError('Tool title must be non-empty and at most 120 characters.');
  }
  if (!description || description.length > 240) {
    throw usageError('Tool description must be non-empty and at most 240 characters.');
  }
  if (!categoryIdPattern.test(categoryId)) {
    throw usageError('Category ID must use lowercase kebab-case and be at most 64 characters.');
  }
  if (outputKind !== 'text' && outputKind !== 'table') {
    throw usageError('Output kind must be text or table.');
  }
  if (capability !== 'none' && capability !== 'runtime.info') {
    throw usageError('Capability must be none or runtime.info.');
  }
  return {
    id,
    name,
    version,
    toolId,
    toolTitle,
    description,
    categoryId,
    outputKind,
    capability,
    directory: resolve(values.get('directory') ?? join(defaultPluginsDirectory, `${id}-v2`)),
  };
}

async function buildFiles(config) {
  const contributionId = `${config.id}/${config.toolId}`;
  const commandId = `${config.id}/run-${config.toolId}`;
  const manifest = {
    formatVersion: 2,
    id: config.id,
    name: config.name,
    version: config.version,
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: config.capability === 'none' ? [] : [config.capability],
    activationEvents: [`onTool:${contributionId}`, `onCommand:${commandId}`],
    contributions: {
      tools: [{
        id: contributionId,
        title: config.toolTitle,
        description: config.description,
        keywords: ['plugin', config.toolId],
        categoryId: config.categoryId,
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: config.capability === 'none' ? [] : [config.capability],
        settings: [],
        dataProviders: [],
        inputs: [{
          kind: 'text',
          id: 'input',
          label: 'Input',
          description: 'Replace this field with the input your command needs.',
          multiline: true,
          required: false,
          maxLength: 16_384,
        }],
        output: { kind: config.outputKind },
      }],
      commands: [{
        id: commandId,
        title: `Run ${config.toolTitle}`,
        description: `Run the ${config.toolTitle} WASM command.`,
        keywords: ['plugin', config.toolId],
        toolId: contributionId,
      }],
      settings: [],
      dataProviders: [],
    },
  };
  const files = new Map([
    ['plugin.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['plugin/build.mjs', buildScript],
    ['plugin/src/extension.c', buildExtensionSource(config.outputKind, config.capability)],
    ['README.md', buildReadme(config, commandId)],
  ]);
  for (const fileName of sdkV2TypeFiles) {
    files.set(join('types', fileName), await readFile(join(sdkV2Directory, fileName), 'utf8'));
  }
  return files;
}

const buildScript = `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(pluginDirectory, 'src/extension.c');
const outputPath = readOutputPath(process.argv.slice(2));
await mkdir(dirname(outputPath), { recursive: true });
const compiler = spawnSync('zig', [
  'cc', '-target', 'wasm32-freestanding', '-std=c11', '-O2', '-fno-builtin', '-nostdlib',
  '-Wl,--no-entry', '-Wl,--import-memory', '-Wl,-z,stack-size=32768',
  '-Wl,--initial-memory=1048576', '-Wl,--max-memory=16777216',
  '-Wl,--export=alloc', '-Wl,--export=execute', '-Wl,--export=free', sourcePath, '-o', outputPath,
], { stdio: 'inherit' });
if (compiler.error) {
  throw new Error(\`无法启动 Zig C 编译器：\${compiler.error.message}\`, { cause: compiler.error });
}
process.exitCode = compiler.status ?? 1;
if (process.exitCode === 0) {
  process.stdout.write(\`已构建 WASM 模块：\${outputPath}\\n\`);
}

function readOutputPath(arguments_) {
  if (arguments_.length === 0) {
    return resolve(pluginDirectory, 'build/extension.wasm');
  }
  if (arguments_.length === 2 && arguments_[0] === '--output' && arguments_[1]) {
    return resolve(arguments_[1]);
  }
  throw new Error('用法：node plugin/build.mjs [--output <wasm 文件路径>]');
}
`;

function buildExtensionSource(outputKind, capability) {
  const resultText = outputKind === 'table'
    ? '{\\"kind\\":\\"table\\",\\"value\\":{\\"columns\\":[{\\"id\\":\\"column1\\",\\"label\\":\\"Column\\"}],\\"rows\\":[[\\"Replace this row\\"]]}}'
    : '{\\"kind\\":\\"text\\",\\"value\\":\\"Replace this WASM command result.\\"}';
  const resultComment = outputKind === 'table'
    ? '宿主会统一渲染表格结果；请替换列、行和插件逻辑。'
    : '宿主会统一渲染文本结果；请在此处替换插件逻辑和输出内容。';
  const capabilityComment = capability === 'runtime.info'
    ? '宿主批准后，请从输入 JSON 的 capabilityContext.runtimeInfo 读取平台和应用版本。'
    : '当前模板没有请求宿主能力。';
  return `#include <stdint.h>

#define REQUEST_CAPACITY (16u * 1024u)
static uint8_t request_buffer[REQUEST_CAPACITY];
static const char result_text[] = "${resultText}";

// 宿主每次执行都会新建模块实例，因此固定请求缓冲区足以支持一次命令调用。
uint32_t alloc(uint32_t size) {
  return size == 0u || size > REQUEST_CAPACITY ? UINT32_MAX : (uint32_t)(uintptr_t)request_buffer;
}

// 固定缓冲区不需要回收；保留该导出以满足公开 ABI。
void free(uint32_t pointer, uint32_t length) {
  (void)pointer;
  (void)length;
}

// ${resultComment}
// ${capabilityComment}
uint64_t execute(uint32_t pointer, uint32_t length) {
  (void)pointer;
  (void)length;
  return ((uint64_t)(uintptr_t)result_text << 32u) | (uint64_t)(sizeof(result_text) - 1u);
}
`;
}

function buildReadme(config, commandId) {
  const codeMark = String.fromCharCode(96);
  const outputDescription = config.outputKind === 'table' ? '表格结果' : '文本结果';
  const capabilityDescription = config.capability === 'runtime.info'
    ? `插件请求 ${codeMark}runtime.info${codeMark}；宿主每次运行前会请求用户批准，并在请求的 ${codeMark}capabilityContext.runtimeInfo${codeMark} 中提供平台和应用版本。`
    : '插件没有请求宿主能力。';
  return [
    `# ${config.name}`,
    '',
    `这是一个 IT Tools 插件系统 v2 WASM 脚手架。工具贡献 ${codeMark}${config.id}/${config.toolId}${codeMark} 使用宿主统一工作台渲染文本字段和${outputDescription}。${capabilityDescription}`,
    '',
    '## 开发',
    '',
    `- 编辑 ${codeMark}plugin.manifest.json${codeMark}，保持贡献 ID 在 ${codeMark}${config.id}${codeMark} 命名空间内。`,
    `- 编辑 ${codeMark}plugin/src/extension.c${codeMark}，入口必须保留 ${codeMark}alloc${codeMark}、${codeMark}execute${codeMark} 和 ${codeMark}free${codeMark} 三个导出。`,
    `- 运行 ${codeMark}node plugin/build.mjs${codeMark} 生成 ${codeMark}plugin/build/extension.wasm${codeMark}。`,
    `- 运行宿主的 ${codeMark}plugin:pack:v2${codeMark} 为清单和 WASM 文件签名。`,
    '',
    `命令 ID 为 ${codeMark}${commandId}${codeMark}。当前模块只返回占位${outputDescription}。它使用 ${codeMark}wasm32-freestanding${codeMark}，不导入 WASI、文件、网络或其他宿主函数。`,
    '',
    '## 打包',
    '',
    `${codeMark.repeat(3)}sh`,
    'node plugin/build.mjs',
    'pnpm --dir /path/to/it-tools-template plugin:pack:v2 \\',
    '  --manifest ./plugin.manifest.json \\',
    '  --wasm ./plugin/build/extension.wasm \\',
    '  --entrypoint extension.wasm \\',
    '  --private-key "$HOME/.config/it-tools/plugin-keys/<key-id>.private.pem" \\',
    '  --key-id <key-id> \\',
    `  --output /tmp/${config.id}.itxs`,
    codeMark.repeat(3),
    '',
    '私钥必须放在仓库外。安装前请在桌面设置中核对签名者指纹。',
    '',
  ].join('\n');
}

/** 创建不覆盖已有目录的 v2 插件脚手架。 */
export async function createPluginV2Scaffold(config) {
  const files = await buildFiles(config);
  await mkdir(dirname(config.directory), { recursive: true });
  try {
    await mkdir(config.directory);
  }
  catch (error) {
    throw new Error(`Plugin v2 directory already exists or cannot be created: ${config.directory}`, { cause: error });
  }
  try {
    for (const [name, contents] of files) {
      const target = join(config.directory, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, { encoding: 'utf8', flag: 'wx' });
    }
  }
  catch (error) {
    await rm(config.directory, { recursive: true, force: true });
    throw new Error(`Plugin v2 scaffold was not fully written under ${config.directory}.`, { cause: error });
  }
  return { directory: config.directory, files: [...files.keys()] };
}

async function main(argv) {
  const config = parseCreatePluginV2Arguments(argv);
  const result = await createPluginV2Scaffold(config);
  process.stdout.write(`Created plugin v2 scaffold: ${result.directory}\n`);
  process.stdout.write(`Runtime: WASM; capabilities: ${config.capability}; output: host-rendered ${config.outputKind}.\n`);
  process.stdout.write('Build the module with `node plugin/build.mjs`, then sign it with `plugin:pack:v2`.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
