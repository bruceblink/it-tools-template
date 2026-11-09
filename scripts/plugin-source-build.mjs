#!/usr/bin/env node

const { runPluginSourceBuildCli } = await import('../electron/plugin-source-build-cli.ts');

await runPluginSourceBuildCli(process.argv.slice(2));
