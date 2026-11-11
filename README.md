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

IT Tools is a privacy-friendly collection of browser-based utilities. The web app processes normal tool input locally in the browser, works as a PWA, and does not require an application server for the built-in tools. The same Vue interface also powers a desktop app with storage and container workbenches.

This repository is a maintained fork of [CorentinTh/it-tools](https://github.com/CorentinTh/it-tools). It adds more tools, broader translations, lazy route loading, offline caching, platform-aware tool registration, and a desktop extension surface.

## What is included

- **117 web tools** in Crypto, Converter, Web, Images & Videos, Development, Network, Math, Measurement, Text, and Data.
- **Desktop workbenches** for API requests, Git, S3-compatible object storage, and read-only Docker container browsing.
- **Extensions and plugins:** trusted first-party extensions and an evolving v2 signed external extension model with host-rendered tools, separate signer trust, and a restricted WASM runtime for pure computation. The existing HTML/webview package flow remains legacy during migration.
- **Desktop updates:** optional automatic checks and user-confirmed download and installation from GitHub Releases.
- **Nine web languages:** English, Chinese, German, French, Spanish, Portuguese, Ukrainian, Vietnamese, and Norwegian.
- **PWA support:** the application shell is precached; visited tool assets are cached by the service worker for later offline use.
- **On-demand navigation:** tool routes and heavy dependencies load when needed; the web app delays service-worker registration to reduce contention with the first tool navigation.

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

Use Node.js 24, pnpm 12.16.1, and Vite 8.3.5. The repository contains the SPA fallback and header configuration for the supported static hosts. For a local production check:

~~~sh
pnpm build
pnpm preview
~~~

The build also writes dist/bundle-report.json, which records shell, route, worker, and runtime asset sizes. Build checks enforce the PWA precache and JavaScript gzip budgets.

## Development

### Requirements

- Node.js 24 LTS or newer
- pnpm 12.16.1 (Corepack can activate the version declared in package.json)

### Install and run

~~~sh
corepack enable
corepack pnpm setup:dev
corepack pnpm dev
~~~

`setup:dev` installs the locked dependencies and verifies the Electron runtime used by the desktop app and Electron tests. If `HTTP_PROXY` or `HTTPS_PROXY` is configured, the setup command enables proxy support only for the Electron download. Use `corepack pnpm env:check` to check the toolchain without changing files. Browser acceptance tests need one additional download:

~~~sh
corepack pnpm setup:browsers
~~~

### Useful commands

| Command | Purpose |
|---|---|
| corepack pnpm setup:dev | Install locked dependencies and the Electron runtime |
| corepack pnpm setup:electron | Install or verify the Electron runtime |
| corepack pnpm setup:browsers | Install Playwright browsers for browser E2E tests |
| corepack pnpm env:check | Check Node.js, pnpm, and Electron without downloading |
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

## Desktop app

The desktop app shares the tool catalog and Vue UI while adding local capabilities through a sandboxed preload bridge. External .itxs packages are currently desktop-only.

~~~sh
corepack pnpm setup:electron
corepack pnpm electron:dev
corepack pnpm electron:build
~~~

Create installers with:

~~~sh
pnpm electron:package:win
pnpm electron:package:linux
pnpm electron:package:mac
~~~

Run desktop smoke tests with pnpm test:e2e:electron. The platform matrix is maintained in [.github/workflows/electron-desktop.yml](.github/workflows/electron-desktop.yml).

## Create a legacy external plugin

Create a plugin source package with a versioned manifest, one namespaced tool contribution, a minimal isolated page, self-contained SDK type declarations, and a local README:

~~~sh
pnpm run plugin:create --id org.example.my-plugin --name "My plugin"
~~~

The default output is `plugins/org.example.my-plugin`. Use `--directory` for a project outside the repository, and review `plugin.source.json` before signing. The `types/` directory contains five self-contained SDK declarations for TypeScript projects. The scaffold targets renderer API `1.4.0`, keeps signing keys outside the source directory, and accepts optional capability declarations:

~~~sh
pnpm run plugin:create --id org.example.my-plugin --name "My plugin" --capabilities runtime.info
~~~

The generated package is metadata and UI only. Validate it before creating signing material:

~~~sh
pnpm run plugin:validate --source plugins/org.example.my-plugin
~~~

The command checks the source manifest, API range, contribution namespace, capability declarations, package paths, file types, and resource limits without reading a private key or writing an archive. `plugin:pack` repeats the same checks before signing. A valid package still does not grant a capability until the desktop host and user approve it.

For a repeatable external-project build, run one command. It validates the source, runs the repository TypeScript compiler when you provide an external `tsconfig.json`, and signs without overwriting an existing package:

~~~sh
pnpm run plugin:build --source ./dist/plugin --tsconfig ./tsconfig.json \
  --private-key "$HOME/.config/it-tools/plugin-publisher.private.pem" \
  --key-id plugin-publisher --output ./artifacts/plugin.itxs
~~~

For a reviewed GitHub source snapshot, pin a full commit and use the explicit source-build command. The command downloads the snapshot, rejects unsafe archive entries, validates the extracted source, performs the optional no-emit TypeScript check, and signs the package with the external key:

~~~sh
corepack pnpm plugin:build-source -- \
  --owner example --name my-plugin --commit <40-char-commit-sha> \
  --private-key "$HOME/.config/it-tools/plugin-publisher.private.pem" \
  --key-id plugin-publisher --output ./artifacts/my-plugin.itxs
~~~

The source-build command does not run repository scripts, install dependencies, or load source directly in Electron. You can also enter the owner, repository, full commit SHA, and signer key ID in the desktop Settings source-build card; the main process selects the private key and installs the generated package. Review the signer fingerprint and approve only the required capabilities. The snapshot commit and archive SHA-256 are reported for review; they do not prove that a published Release was built from that source.

In desktop Settings, the plugin manager starts with a three-step onboarding card that links to the read-only marketplace, explains signer trust, and separates requested, supported, selected, and active capabilities. It also lists, installs, and removes signed v2 packages, shows their declared tools, and edits their non-secret host settings. A v2 WASM tool can request `runtime.info`, the settings it declares, or host-owned OUI data; the desktop host asks for approval on each run and sends a bounded read-only snapshot. Plugin processes cannot write settings, and the process runtime is not available yet.

The new plugin direction is documented in [Plugin system v2 design](docs/22-plugin-architecture-v2.md). A v2 extension contributes commands, declarative fields, result types, capability declarations, optional namespaced scalar settings, and host-owned data provider references. IT Tools renders supported tool pages and registers them for navigation and search. Text, JSON, and bounded table results use host-owned rendering; plugins cannot inject HTML, CSS, Vue components, or custom cell templates. The WASM runtime limits linear memory, module and message sizes, and concurrent workers; it does not enforce an OS-level total memory limit. The `runtime.info`, read-only `settings.read`, and host-owned `data.oui` capabilities are implemented for v2. Settings are persisted in a host-owned plugin namespace and edited in desktop Settings; plugin processes cannot write them. OUI data is read by the host from verified manifest and shard files, queried through a declared text input, and injected as a bounded read-only context. Other capabilities and the process runtime are not complete. The `plugin:create` command creates legacy v1 HTML packages; use `plugin:create:v2` for a buildable WASM v2 scaffold. To sign an existing v2 static manifest and WASM module, use the v2 packer below.

Create a v2 scaffold with a host-rendered text tool:

~~~sh
pnpm run plugin:create:v2 -- --id org.example.my-plugin --name "My plugin"
~~~

The generated project contains `plugin.manifest.json`, a minimal `alloc`/`execute`/`free` WASM module, a Zig build script, self-contained `types/` declarations for the v2 manifest, package envelope, command results, and WASM ABI, and a README for `plugin:pack:v2`. It requests no host capabilities and does not provide HTML, CSS, Vue components, or custom rendering templates.

## Sign a v2 WASM plugin

Use Node.js 24 and the repository's pinned pnpm version. Create a `plugin.manifest.json` containing the v2 static manifest fields shown in [Plugin system v2 design](docs/22-plugin-architecture-v2.md). Do not add `runtime`, `entrypoint`, `files`, or `signature`; the packer creates those package fields. The manifest API range must include host API `2.0.0`.

Create a signing key outside the repository, then pack the existing WASM module:

~~~sh
pnpm run plugin:keygen --key-id example-publisher --output-directory "$HOME/.config/it-tools/plugin-keys"
pnpm run plugin:pack:v2 \
  --manifest ./plugin.manifest.json \
  --wasm ./build/plugin.wasm \
  --entrypoint extension.wasm \
  --private-key "$HOME/.config/it-tools/plugin-keys/example-publisher.private.pem" \
  --key-id example-publisher \
  --output ./artifacts/example-plugin.itxs
~~~

Validate the static manifest before compiling or signing. This command reads only `plugin.manifest.json`; it does not read a private key, load the WASM file, execute plugin code, or write an archive:

~~~sh
pnpm run plugin:validate:v2 --manifest ./plugin.manifest.json
~~~

The command prints the validated plugin ID and version. It rejects package envelope fields such as `runtime`, `entrypoint`, `files`, and `signature`; those fields are added by `plugin:pack:v2`.

The package contains the signed v2 manifest and the selected WASM file. The packer uses the host's shared v2 manifest validator, then checks the signing key, entrypoint path, and file limits. The desktop installer rechecks the manifest, signer trust, and file hashes; the extension host checks the WASM ABI when it executes the module. Run `pnpm run test:plugin-pack:v2` for a packer-to-installer-to-WASM execution check. Signing does not grant requested capabilities.

For a complete C-to-WASM example, see [the WASM integer doubling plugin](plugins/wasm-double/README.md). It includes a declarative manifest, a Zig build command, and an opt-in test against the production WASM executor.

## Plugin marketplace

Open /plugin-marketplace to browse community plugin repositories. The directory queries the GitHub REST API for public repositories tagged with the it-tools-plugin topic, shows repository and manifest metadata, and links back to GitHub. In the desktop app, the page can install the latest eligible signed Release through the host bridge, showing progress and cancellation; the package is streamed to a temporary local directory and then passed to the existing verifier. The marketplace does not store, proxy, execute, or distribute plugin packages.

Plugin authors should add the it-tools-plugin topic, keep a clear README, commit a plugin.source.json manifest, and publish exactly one signed `.itxs` asset in the latest stable Release for desktop direct install. The page reads source metadata only as reference data; signing, trust, capability approval, and installation remain part of the desktop workflow. See the marketplace directory contract in docs/20-plugin-marketplace.md and the installation flow in docs/21-plugin-install-flow.md.

## Architecture and project docs

The web and desktop apps share the same Vue application, tool catalog, routes, translations, and UI. The two entry points differ at the platform boundary:

| Component | Responsibility |
|---|---|
| Shared app (`src/app.ts`, `src/router.ts`) | Mounts Vue, Pinia, routing, translations, and the UI providers. Routes load tool pages on demand. |
| Tool registry (`src/tools/`) | Defines tool identity, category, supported platforms, data-processing mode, offline availability, and required capabilities. |
| Web entry (`src/main.ts`) | Runs browser-supported tools and registers the PWA service worker after startup. |
| Desktop host (`electron/`, `electron-renderer/`) | Reuses the shared UI and exposes local workbenches through a narrow preload and IPC interface. Main-process services own native operations and their resources. |
| Extension host (`src/extensions/`, v2 RPC boundary, `electron/plugin-*`) | Loads trusted first-party extensions, prepares host-rendered v2 contributions, and keeps legacy signed packages isolated during migration. |

For example, a tool route is selected from the registry, filtered for the current platform, and loaded when the user opens it. Browser operations use the platform adapter. Desktop-only workbenches call the preload bridge, which forwards the request to the responsible host service. The web build must not include desktop drivers or IPC modules.

The interface is designed for repeated practical work: tools are searchable and grouped by category, favorites remain available across sessions, and larger workbenches keep their own controls close to their data. The shared interface supports light and dark themes and adapts to narrow windows. Tool input is processed locally unless a tool explicitly needs network access; its declared data-processing and capability metadata describe that boundary.

The plugin marketplace is a read-only GitHub directory, not a package host. A desktop installation downloads a signed package and passes it to the existing verifier. Trusting a signer and granting capabilities are separate user decisions. Release metadata records where the package was obtained; it does not prove that the package was built from the displayed commit.

The [main development plan](docs/01-development-plan.md) is the only document that tracks priorities, unfinished work, code review findings, and acceptance conditions. The documents below are technical references only; they do not contain a second roadmap or schedule. Completed plans and duplicate development logs have been removed; Git retains their history. The unapproved Excalidraw assessment is archived under `docs/archive/`. Dated performance reports and licenses remain in `docs/`.

- [Performance and plugin architecture](docs/07-performance-extensibility-design.md): loading, caching, platform boundaries, workers, and evidence limits
- [Desktop plugin package format](docs/08-electron-plugin-package-format-v1.md): signed archive format
- [Plugin development API](docs/09-electron-plugin-capability-api-v1.md): versioned runtime interface
- [Plugin lifecycle](docs/10-electron-plugin-lifecycle-v1.md): install, enable, disable, rollback, and uninstall
- [Plugin quickstart](docs/11-electron-plugin-mvp-quickstart.md): development and local validation
- [First-party extension SDK v0](docs/extension-sdk-v0.md): trusted extensions bundled with the application
- [Plugin system v2 design](docs/22-plugin-architecture-v2.md): host-rendered contributions, extension host RPC, capabilities, and migration boundaries
- [Cross-project capability matrix](docs/14-cross-project-capability-matrix.md): independent project scope
- [Object storage workbench](docs/15-object-storage-workbench-design.md): S3-compatible browsing and transfers
- [Container workbench](docs/17-container-workbench-design.md): read-only local Docker container list
- [Archived Excalidraw assessment](docs/archive/18-excalidraw-integration-assessment.md): historical options and prerequisites; not approved for implementation
- [Desktop updates](docs/19-desktop-updates.md): update checks, differential downloads, installation confirmation, and release files
- [Plugin install flow](docs/21-plugin-install-flow.md): read-only GitHub discovery, signed release installation, and explicit developer source builds

Route components and heavy workers are loaded only when needed. The service worker caches same-origin build assets with a bounded per-build cache. See the performance and plugin architecture document for the limits and platform-specific details.

## Release and contribution workflow

Before opening a pull request, run:

~~~sh
pnpm validate
~~~

This runs header consistency checks, script tests, type checks, lint, unit tests, the production build, Web platform isolation checks, and the Electron build. Browser acceptance suites are run separately when the change needs them.

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

This project is distributed under the [GNU General Public License v3.0 (GPLv3)](LICENSE).
