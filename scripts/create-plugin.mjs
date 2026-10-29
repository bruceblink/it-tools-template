import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const defaultPluginsDirectory = join(repositoryRoot, 'plugins');
const pluginApiVersion = '1.4.0';
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const pluginToolIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const knownCapabilities = new Set([
  'clipboard.write',
  'data.oui',
  'device.camera',
  'file.read',
  'file.save',
  'runtime.info',
  'settings.read',
  'settings.write',
]);

function usageError(message) {
  return new Error(`${message}\nUsage: pnpm plugin:create -- --id <plugin-id> --name <display-name> [--directory <path>] [--version <semver>] [--tool-id <slug>] [--tool-title <title>] [--description <text>] [--capabilities <capability,...>]`);
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
    if (!['id', 'name', 'directory', 'version', 'tool-id', 'tool-title', 'description', 'capabilities'].includes(name)) {
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

function parseCapabilityList(value) {
  if (value === undefined || value === 'none') {
    return [];
  }
  const capabilities = value.split(',').map(item => item.trim()).filter(Boolean);
  if (
    capabilities.length === 0
    || new Set(capabilities).size !== capabilities.length
    || capabilities.some(capability => !knownCapabilities.has(capability))
  ) {
    throw usageError(`Invalid capability list: ${value}`);
  }
  return capabilities;
}

/** Parse the bounded inputs used by the plugin source scaffold. */
export function parseCreatePluginArguments(argv) {
  const values = parseOptionValues(argv);
  const id = values.get('id');
  const name = values.get('name')?.trim();
  const version = values.get('version') ?? '0.1.0';
  const toolId = values.get('tool-id') ?? 'tool';
  const toolTitle = values.get('tool-title')?.trim() ?? name;
  const description = values.get('description')?.trim() ?? 'A starting point for an IT Tools plugin.';
  const capabilities = parseCapabilityList(values.get('capabilities'));
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
  return {
    id,
    name,
    version,
    toolId,
    toolTitle,
    description,
    capabilities,
    directory: resolve(values.get('directory') ?? join(defaultPluginsDirectory, id)),
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

// Keep generated metadata inside the script element when names contain HTML-sensitive characters.
function serializeScriptData(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  })[character]);
}

function buildFiles(config) {
  const contributionId = `${config.id}/${config.toolId}`;
  const manifest = {
    formatVersion: 1,
    id: config.id,
    name: config.name,
    version: config.version,
    apiVersion: { minInclusive: pluginApiVersion, maxExclusive: '2.0.0' },
    entrypoint: 'index.html',
    requestedCapabilities: config.capabilities,
    contributions: {
      tools: [{
        id: contributionId,
        title: config.toolTitle,
        description: config.description,
        keywords: ['plugin', config.toolId],
        dataProcessing: 'local-data',
        offline: 'available',
        capabilities: config.capabilities,
      }],
    },
  };
  const title = escapeHtml(config.toolTitle);
  const description = escapeHtml(config.description);
  const pluginContext = serializeScriptData({ id: config.id, name: config.name, version: config.version });
  const toolContext = serializeScriptData({ id: contributionId, title: config.toolTitle });
  return new Map([
    ['plugin.source.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['index.html', `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <title>${title}</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="page">
      <p class="eyebrow">IT Tools plugin</p>
      <h1>${title}</h1>
      <p>${description}</p>
      <dl>
        <div><dt>Plugin</dt><dd id="plugin-context"></dd></div>
        <div><dt>Tool contribution</dt><dd id="tool-context"></dd></div>
      </dl>
      <p class="notice">Replace this page with the plugin UI. Host capabilities are available only after user approval.</p>
    </main>
    <script src="/plugin.js"></script>
  </body>
</html>
`],
    ['styles.css', `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; background: #111827; color: #f9fafb; }
.page { box-sizing: border-box; max-width: 720px; margin: 0 auto; padding: 64px 24px; }
.eyebrow { color: #93c5fd; font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase; }
h1 { margin-bottom: 12px; }
dl { display: grid; gap: 12px; margin: 32px 0; }
dl div { padding: 16px; border: 1px solid #374151; border-radius: 12px; }
dt { color: #9ca3af; font-size: 0.85rem; }
dd { margin: 4px 0 0; overflow-wrap: anywhere; }
.notice { color: #d1d5db; }
`],
    ['plugin.js', `const pluginContext = ${pluginContext};
const toolContext = ${toolContext};
document.querySelector('#plugin-context').textContent = [pluginContext.name, pluginContext.version].join(' · ');
document.querySelector('#tool-context').textContent = toolContext.id;
// Use window.itTools.capabilities only for operations declared in plugin.source.json.
`],
    ['README.md', `# ${config.name}

This plugin was generated for IT Tools plugin API ${pluginApiVersion}.

1. Review \`plugin.source.json\` and replace the generated page.
2. Copy the SDK declarations from \`plugins/sdk/\` into your plugin project when using TypeScript.
3. Generate a signing key outside the repository and run \`pnpm plugin:pack\`.

The generated contribution is metadata only. It does not grant capabilities or execute host operations until the user approves a matching capability in the Electron settings page.
`],
  ]);
}

/** Create a non-overwriting plugin source directory that the signed packer accepts. */
export async function createPluginScaffold(config) {
  const files = buildFiles(config);
  await mkdir(dirname(config.directory), { recursive: true });
  try {
    await mkdir(config.directory);
  }
  catch (error) {
    throw new Error(`Plugin directory already exists or cannot be created: ${config.directory}`, { cause: error });
  }
  try {
    for (const [name, contents] of files) {
      await writeFile(join(config.directory, name), contents, { encoding: 'utf8', flag: 'wx' });
    }
  }
  catch (error) {
    await rm(config.directory, { recursive: true, force: true });
    throw new Error(`Plugin scaffold was not fully written under ${config.directory}.`, { cause: error });
  }
  return { directory: config.directory, files: [...files.keys()] };
}

async function main(argv) {
  const config = parseCreatePluginArguments(argv);
  const result = await createPluginScaffold(config);
  console.log(`Created plugin scaffold: ${result.directory}`);
  console.log(`Plugin API range: ${pluginApiVersion} <= apiVersion < 2.0.0`);
  console.log('Review the manifest and keep signing keys outside the repository before packing.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
