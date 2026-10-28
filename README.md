<picture>
  <source srcset="./.github/logo-dark.png" media="(prefers-color-scheme: light)">
  <source srcset="./.github/logo-white.png" media="(prefers-color-scheme: dark)">
  <img src="./.github/logo-dark.png" alt="IT Tools logo">
</picture>

<p align="center">
  Practical tools for developers and people working in IT.
  <a href="https://tools.likanug.app">Open the web app</a>
</p>

<p align="center">
  <img alt="Latest release" src="https://img.shields.io/github/v/tag/bruceblink/it-tools-template?label=release&color=blue">
  <img alt="License" src="https://img.shields.io/github/license/bruceblink/it-tools-template">
  <img alt="Tech stack" src="https://img.shields.io/badge/stack-Vue%203%20%2B%20Vite%20%2B%20Naive%20UI-42b883">
</p>

IT Tools is a privacy-friendly collection of browser-based utilities. The web app processes normal tool input locally in the browser, works as a PWA, and does not require an application server for the built-in tools. The same Vue interface also powers an Electron desktop app with local database, system, storage, and container workbenches.

This repository is a maintained fork of [CorentinTh/it-tools](https://github.com/CorentinTh/it-tools). It adds more tools, broader translations, lazy route loading, offline caching, platform-aware tool registration, and an Electron extension surface.

## What is included

- **117 web tools** in Crypto, Converter, Web, Images & Videos, Development, Network, Math, Measurement, Text, and Data.
- **Electron-only workbenches** for database management, system monitoring, API requests, Git, object storage, and containers.
- **Nine web languages:** English, Chinese, German, French, Spanish, Portuguese, Ukrainian, Vietnamese, and Norwegian.
- **PWA support:** the application shell is precached; visited tool assets are cached by the service worker for later offline use.
- **Fast navigation:** tool routes are lazy-loaded, warmed during browser idle time, and prefetched when a link receives pointer or keyboard intent.

Have an idea for a new tool? Open a [feature request](https://github.com/bruceblink/it-tools/issues/new/choose).

## Use the hosted app

Open [tools.likanug.app](https://tools.likanug.app). Built-in web tools run in your browser. Network access is only used by tools that explicitly need it, such as request or lookup utilities.

## Self-host with Docker

The image serves the production build through Nginx:

~~~sh
docker run -d \
  --name it-tools \
  --restart unless-stopped \
  -p 8080:80 \
  bruceblink/it-tools:latest
~~~

You can also use the GitHub Container Registry image:

~~~sh
docker run -d \
  --name it-tools \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/bruceblink/it-tools:latest
~~~

Open [http://localhost:8080](http://localhost:8080) after the container starts. The Docker image includes the SPA fallback and the security headers generated from [security-headers.json](security-headers.json).

## Deploy the web build

The production output is the dist directory.

| Platform | Build command | Output |
|---|---|---|
| Cloudflare Pages | pnpm build | dist |
| Vercel | pnpm build | dist |
| Netlify | pnpm build | dist |

Use Node.js 24 and pnpm 12.15.0. The repository contains the SPA fallback and header configuration for the supported static hosts. For a local production check:

~~~sh
pnpm build
pnpm preview
~~~

The build also writes dist/bundle-report.json, which records shell, route, worker, and runtime asset sizes. Build checks enforce the PWA precache and JavaScript gzip budgets.

## Development

### Requirements

- Node.js 24 LTS or newer
- pnpm 12.15.0 (Corepack can activate the version declared in package.json)

### Install and run

~~~sh
corepack enable
pnpm install
pnpm dev
~~~

### Useful commands

| Command | Purpose |
|---|---|
| pnpm dev | Start Vite with hot reload |
| pnpm build | Build the production web/PWA bundle |
| pnpm preview | Serve dist locally |
| pnpm test:unit --run | Run unit tests once |
| pnpm test:e2e | Run browser acceptance tests |
| pnpm typecheck | Check Vite/config types |
| pnpm typecheck:app | Check Vue application types |
| pnpm lint --max-warnings 0 | Run ESLint without warnings |
| pnpm validate | Run the full release validation gate |

auto-imports.d.ts and components.d.ts are generated locally and ignored by Git. pnpm typecheck:app prepares the declarations automatically.

## Add a tool

Use the scaffold command so the route, translations, metadata, and tests stay consistent:

~~~sh
pnpm run script:create:tool my-tool-name \
  --category development \
  --title-zh "我的工具" \
  --data-processing memory-only \
  --offline available \
  --platforms web,electron
~~~

Review the generated ToolDefinition before implementing the page. Declare only the capabilities the tool needs:

~~~sh
pnpm run script:create:tool my-tool-name \
  --category development \
  --title-zh "我的工具" \
  --data-processing user-selected-files \
  --offline available \
  --platforms web \
  --capabilities clipboard.write,file.save
~~~

Tool metadata controls platform visibility, route registration, search, offline labels, and the Web/Electron build boundary. Web builds must not include Electron-only drivers or IPC modules.

## Electron desktop app

The desktop app shares the tool catalog and Vue UI while adding local capabilities through a sandboxed preload bridge. External .itplugin packages are currently Electron-only.

~~~sh
pnpm exec install-electron
pnpm electron:dev
pnpm electron:build
~~~

Create installers with:

~~~sh
pnpm electron:package:win
pnpm electron:package:linux
pnpm electron:package:mac
~~~

Run desktop smoke tests with pnpm test:e2e:electron. The platform matrix is maintained in [.github/workflows/electron-desktop.yml](.github/workflows/electron-desktop.yml).

## Architecture and project docs

- [Development plan](docs/01-development-plan.md) — roadmap and release gates
- [Performance, extensibility, and plugins](docs/07-performance-extensibility-design.md) — performance, platform, and extension boundaries
- [Electron plugin package format](docs/08-electron-plugin-package-format-v1.md) — signed package format
- [Capability API](docs/09-electron-plugin-capability-api-v1.md) — desktop capability interface
- [Electron plugin quickstart](docs/11-electron-plugin-mvp-quickstart.md) — plugin development
- [Database and system workbenches](docs/13-database-system-monitor-design.md) — desktop workbench design
- [Cross-project capability matrix](docs/14-cross-project-capability-matrix.md) — Web/Electron scope boundaries

The application is organized around Vue route pages, a typed tool registry, Pinia stores, local i18n resources, and platform adapters. Route components and heavy workers are loaded only when needed. The service worker caches same-origin build assets with a bounded per-build cache.

## Release and contribution workflow

Before opening a pull request, run:

~~~sh
pnpm validate
~~~

This runs header consistency checks, script tests, type checks, lint, unit tests, the production build, Web platform isolation checks, and the Electron build. Browser and database acceptance suites are run separately when the change needs them.

For a local release preview:

~~~sh
pnpm release:dry-run
~~~

To create the versioned release commit and tag:

~~~sh
pnpm release
git push && git push --tags
~~~

Please keep changes focused, include meaningful tests for behavior changes, and update the relevant design record when a platform boundary or release process changes.

## License

This project is distributed under the [GNU Affero General Public License v3.0](LICENSE).
