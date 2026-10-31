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

## Create an external plugin

Create a plugin source package with a versioned manifest, one namespaced tool contribution, a minimal isolated page, self-contained SDK type declarations, and a local README:

~~~sh
pnpm plugin:create -- --id org.example.my-plugin --name "My plugin"
~~~

The default output is `plugins/org.example.my-plugin`. Use `--directory` for a project outside the repository, and review `plugin.source.json` before signing. The `types/` directory contains five self-contained SDK declarations for TypeScript projects. The scaffold targets renderer API `1.4.0`, keeps signing keys outside the source directory, and accepts optional capability declarations:

~~~sh
pnpm plugin:create -- --id org.example.my-plugin --name "My plugin" --capabilities runtime.info
~~~

The generated package is metadata and UI only. Validate it before creating signing material:

~~~sh
pnpm plugin:validate -- --source plugins/org.example.my-plugin
~~~

The command checks the source manifest, API range, contribution namespace, capability declarations, package paths, file types, and resource limits without reading a private key or writing an archive. `plugin:pack` repeats the same checks before signing. A valid package still does not grant a capability until the Electron host and user approve it.

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

<<<<<<< HEAD
~~~sh
=======
The current execution plan is in [Development Plan](docs/01-development-plan.md). Performance, platform, and plugin design records are in [Performance, Extensibility, and Plugins](docs/07-performance-extensibility-design.md); cross-project boundaries remain explicit and independent. This repository owns the Web/PWA product, the Electron workbenches, and the shared tool catalog; `ramag-platform` owns only the native core and GPUI client. The Electron plugin pilot includes signed package installation, capability approval, version fallback, and signer revocation; cross-platform and native-window acceptance is still in progress. The external plugin v1 interfaces are defined in [Electron Plugin Package Format](docs/08-electron-plugin-package-format-v1.md), [Capability API](docs/09-electron-plugin-capability-api-v1.md), [Lifecycle Service](docs/10-electron-plugin-lifecycle-v1.md), and [MVP Quickstart](docs/11-electron-plugin-mvp-quickstart.md). The maintained first-party internal extension interface remains documented in [First-Party Extension SDK v0](docs/extension-sdk-v0.md). Earlier quality work is recorded in [archived Quality Baseline](docs/archive/02-quality-baseline.md).

The Electron database manager and local system monitor are described in [Database Manager and System Monitor Design](docs/13-database-system-monitor-design.md). They are the first product workbenches replacing duplicate scope from `ramag-platform`. The database MVP targets PostgreSQL, MySQL, and SQLite; paginated browsing, saved connections, the other engines, and live system metrics follow the design record. SSH/SFTP/PTY remain outside the current it-tools-template scope and are developed independently by Ramag. Application credentials stay in Electron's system-backed storage.

Electron plugin developers can use the signed package CLI and maintained [Capability demo](plugins/capability-demo/). See [Electron Plugin MVP Quickstart](docs/11-electron-plugin-mvp-quickstart.md) for key storage, package creation, trust, and install steps. External plugins remain Electron-only.

The two security tasks and their acceptance results are in the archived [Random Sources and Sensitive Inputs](docs/archive/03-security-inputs-plan.md).

Content privacy, sanitized rendering, and deployment headers are described in the archived [Content, HTML, and Deployment Boundaries](docs/archive/04-security-boundaries.md). The credential, request, configuration, and document inputs covered there stay in page memory; existing display and processing preferences may still be saved.

The PWA precaches the application shell and caches tool assets after use. It stores only same-origin build resources, with a 160-entry, 30-day limit for each build and service-worker scope. Offline availability depends on those resources remaining in browser storage. The completed cache boundary is documented in the archived [Application Shell and Offline Cache](docs/archive/05-pwa-cache-plan.md); remaining performance work is tracked in [Performance, Extensibility, and Plugins](docs/07-performance-extensibility-design.md).

Every production build writes `dist/bundle-report.json` with raw and gzip sizes for the shell, optional entry closures, incremental tool JavaScript, and runtime assets, including workers. Builds fail when the initial precache exceeds 8 MiB, initial JavaScript exceeds 300 KiB gzip, or a tool needs more than 500 KiB of additional static JavaScript after the shell has loaded. Worker scripts load when a task starts and are reported separately. The PWA registration helper loads after the app mounts and is outside the shell. CI uploads the report as an artifact. After building, run the focused offline acceptance with `pnpm test:e2e src/pwa-cache.e2e.spec.ts`.

The Electron desktop app shares the Vue interface and tool routes. Install the local Electron runtime once with `pnpm exec install-electron`, then use `pnpm electron:dev` for development and `pnpm electron:build` for the desktop build. Native runners create a Windows NSIS installer with `pnpm electron:package:win`, Linux AppImage and deb packages with `pnpm electron:package:linux`, or macOS dmg and zip packages with `pnpm electron:package:mac`. Run the Electron smoke checks with `pnpm test:e2e:electron`; [GitHub Actions](.github/workflows/electron-desktop.yml) builds and tests all three platforms. [Release v2026.10.16-08de8e6](https://github.com/bruceblink/it-tools-template/releases/tag/v2026.10.16-08de8e6) includes the Web ZIP and Windows x64, Linux x64, and macOS ARM64 desktop packages, with Docker image tags in its notes. The desktop renderer uses a secure local `app://` origin, skips the Web Service Worker, and exposes a narrow sandboxed preload bridge. Camera Recorder has an explicit consent flow; real-device recovery, signing, notarization, installation, upgrade, and uninstall acceptance remain open.

The shared Web/Electron boundary and its acceptance limits are recorded in [Performance, Extensibility, and Plugins](docs/07-performance-extensibility-design.md).

Deployment headers are generated from `security-headers.json`. Run `pnpm headers:sync` after editing that source and `pnpm headers:check` to detect drift. A custom Plausible API requires the same exact HTTPS origin in `plausibleApiOrigin` and `VITE_PLAUSIBLE_API_HOST`; run the sync/check commands with that build variable set.

After the final production build, `pnpm headers:docker` checks real Nginx responses using local Docker on `127.0.0.1:18080` and removes its container. Start Docker and pull `nginx:stable-alpine` before running this check.

### Create a New Tool

Run the scaffold script to create a tool with an explicit category, platform, data policy, and offline policy:

```sh
pnpm run script:create:tool my-tool-name --category development --title-zh "我的工具" --data-processing memory-only --offline available --platforms web,electron
```

The script creates the component, a typed `ToolDefinition`, a registry validation test, and an end-to-end scaffold assertion. It registers the tool in the requested category and adds English and Chinese title and description entries. The generated description is a TODO. Replace it and review all declared metadata before implementing the tool. Add `--capabilities clipboard.write,file.save` only when the tool requires those capabilities.

### Create a Plugin

Create a plugin source package with a versioned manifest, one namespaced tool contribution, a minimal isolated page, self-contained SDK type declarations, and a local README:

```sh
pnpm plugin:create -- --id org.example.my-plugin --name "My plugin"
```

The default output is `plugins/org.example.my-plugin`. Use `--directory` for a project outside the repository, and review `plugin.source.json` before signing. The `types/` directory contains the five self-contained SDK declarations for TypeScript projects. The scaffold targets the current renderer API `1.4.0`, keeps signing keys outside the source directory, and accepts optional capability declarations:

```sh
pnpm plugin:create -- --id org.example.my-plugin --name "My plugin" --capabilities runtime.info
```

The generated package is metadata and UI only. Validate it before creating signing material:

```sh
pnpm plugin:validate -- --source plugins/org.example.my-plugin
```

The command checks the source manifest, API range, contribution namespace, capability declarations, package paths, file types, and resource limits without reading a private key or writing an archive. `plugin:pack` repeats the same checks before signing. A valid package still does not grant a capability until the Electron host and user approve it.

Excalidraw integration is under assessment. The current evaluation covers local drawing, read-only sharing, real-time collaboration, React/Vue integration, and the plugin network boundary: [Excalidraw integration assessment](docs/18-excalidraw-integration-assessment.md).

### Release Flow

Preview the generated changelog without touching any files:

```sh
>>>>>>> 686457d (feat(plugin): add plugin project scaffold)
pnpm release:dry-run
~~~

To create the versioned release commit and tag:

~~~sh
pnpm release
git push && git push --tags
~~~

Please keep changes focused, include meaningful tests for behavior changes, and update the relevant design record when a platform boundary or release process changes.

## License

This project is distributed under the [GNU General Public License v3.0 (GPLv3)](LICENSE).
