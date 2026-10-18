<picture>
    <source srcset="./.github/logo-dark.png" media="(prefers-color-scheme: light)">
    <source srcset="./.github/logo-white.png" media="(prefers-color-scheme: dark)">
    <img src="./.github/logo-dark.png" alt="logo">
</picture>

<p align="center">
Useful tools for developer and people working in IT. <a href="https://tools.likanug.app">Try it!</a>
</p>

<p align="center">
  <img alt="Latest release" src="https://img.shields.io/github/v/tag/bruceblink/it-tools-template?label=release&color=blue">
  <img alt="License" src="https://img.shields.io/github/license/bruceblink/it-tools-template">
  <img alt="Tech stack" src="https://img.shields.io/badge/stack-Vue3%20%2B%20Vite%20%2B%20Naive%20UI-42b883">
</p>

## Overview

This project is a customized fork of [CorentinTh/it-tools](https://github.com/CorentinTh/it-tools), extended with additional tools, improved i18n coverage, enhanced UI interactions, and a more automated release workflow.

**117 tools** across 11 categories: Crypto, Converter, Web, Images & Videos, Development, Network, Math, Measurement, Text, Data, and Favorites.

**9 languages**: English, Chinese (zh), German (de), French (fr), Spanish (es), Portuguese (pt), Ukrainian (uk), Vietnamese (vi), Norwegian (no).

Have an idea for a new tool? Submit a [feature request](https://github.com/bruceblink/it-tools/issues/new/choose)!

## Self Host

**From Docker Hub:**

```sh
docker run -d --name it-tools --restart unless-stopped -p 8080:80 bruceblink/it-tools:latest
```

**From GitHub Packages:**

```sh
docker run -d --name it-tools --restart unless-stopped -p 8080:80 ghcr.io/bruceblink/it-tools:latest
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Vue 3 + TypeScript |
| Build | Vite 7 |
| UI Library | Naive UI |
| Styling | UnoCSS |
| State | Pinia |
| i18n | vue-i18n |
| Testing | Vitest + Playwright |
| Deployment | Vercel |

## Contribute

### Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) with the following extensions:

- [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur)
- [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin)
- [i18n Ally](https://marketplace.visualstudio.com/items?itemName=lokalise.i18n-ally)

Recommended workspace settings:

```json
{
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "i18n-ally.localesPaths": ["locales", "src/tools/*/locales"],
  "i18n-ally.keystyle": "nested"
}
```

### Project Setup

Requires Node.js 24 LTS or newer. The repository selects the Node 24 release line in `.nvmrc` and pins pnpm 12.14.0 through Corepack.

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

### Run Unit Tests

```sh
pnpm test
```

### Validate Before Release

```sh
pnpm validate
```

`pnpm validate` runs `pnpm check`: deployment header consistency and script tests, PWA build-boundary tests, build configuration types, application and test types, lint with zero warnings, unit tests, and the production build. Run browser acceptance separately with `pnpm test:e2e` after building the app.

`auto-imports.d.ts` is generated locally and ignored by Git. `pnpm typecheck:app` prepares it automatically, so typechecking also works from a clean checkout.

The current roadmap is in [Development Plan](docs/01-development-plan.md). Performance and tool-registration foundations and the internal first-party extension SDK are implemented. The Electron plugin pilot includes signed package installation, capability approval, version fallback, and signer revocation; cross-platform and native-window acceptance is still in progress. Scope and isolation requirements are in [Performance, Extensibility, and Plugins](docs/07-performance-extensibility-plan.md), and the current interface boundaries are in [First-Party Extension SDK v0](docs/extension-sdk-v0.md). Earlier quality work is recorded in [Quality Baseline](docs/02-quality-baseline.md).

The two security tasks and their acceptance results are in [Random Sources and Sensitive Inputs](docs/03-security-inputs-plan.md).

Content privacy, sanitized rendering, and deployment headers are described in [Content, HTML, and Deployment Boundaries](docs/04-security-boundaries.md). The credential, request, configuration, and document inputs covered there stay in page memory; existing display and processing preferences may still be saved.

The PWA precaches the application shell and caches tool assets after use. It stores only same-origin build resources, with a 160-entry, 30-day limit for each build and service-worker scope. Offline availability depends on those resources remaining in browser storage. Build budgets, cache boundaries, and remaining performance work are documented in [Application Shell and Offline Cache](docs/05-pwa-cache-plan.md).

Every production build writes `dist/bundle-report.json` with raw and gzip sizes for the shell, optional entry dependency closures, and emitted runtime assets, including workers. Builds fail when the initial precache exceeds 8 MiB, initial JavaScript exceeds 300 KiB gzip, or an optional entry closure exceeds 500 KiB gzip. The PWA registration helper loads after the app mounts and is outside the shell. CI uploads the report as an artifact. After building, run the focused offline acceptance with `pnpm test:e2e src/pwa-cache.e2e.spec.ts`.

The Electron desktop app shares the Vue interface and tool routes. Install the local Electron runtime once with `pnpm exec install-electron`, then use `pnpm electron:dev` for development and `pnpm electron:build` for the desktop build. Native runners create a Windows NSIS installer with `pnpm electron:package:win`, Linux AppImage and deb packages with `pnpm electron:package:linux`, or macOS dmg and zip packages with `pnpm electron:package:mac`. Run the Electron smoke checks with `pnpm test:e2e:electron`; [GitHub Actions](.github/workflows/electron-desktop.yml) builds and tests all three platforms. [Release v2026.10.16-08de8e6](https://github.com/bruceblink/it-tools-template/releases/tag/v2026.10.16-08de8e6) includes the Web ZIP and Windows x64, Linux x64, and macOS ARM64 desktop packages, with Docker image tags in its notes. The desktop renderer uses a secure local `app://` origin, skips the Web Service Worker, and exposes a narrow sandboxed preload bridge. Camera Recorder has an explicit consent flow; real-device recovery, signing, notarization, installation, upgrade, and uninstall acceptance remain open.

The feasibility and value of sharing the current web interface with an Electron desktop app are assessed in [Web and Electron Assessment](docs/06-web-electron-assessment.md).

Deployment headers are generated from `security-headers.json`. Run `pnpm headers:sync` after editing that source and `pnpm headers:check` to detect drift. A custom Plausible API requires the same exact HTTPS origin in `plausibleApiOrigin` and `VITE_PLAUSIBLE_API_HOST`; run the sync/check commands with that build variable set.

After the final production build, `pnpm headers:docker` checks real Nginx responses using local Docker on `127.0.0.1:18080` and removes its container. Start Docker and pull `nginx:stable-alpine` before running this check.

### Create a New Tool

Run the scaffold script to create a tool with an explicit category, platform, data policy, and offline policy:

```sh
pnpm run script:create:tool my-tool-name --category development --title-zh "我的工具" --data-processing memory-only --offline available --platforms web,electron
```

The script creates the component, a typed `ToolDefinition`, a registry validation test, and an end-to-end scaffold assertion. It registers the tool in the requested category and adds English and Chinese title and description entries. The generated description is a TODO. Replace it and review all declared metadata before implementing the tool. Add `--capabilities clipboard.write,file.save` only when the tool requires those capabilities.

### Release Flow

Preview the generated changelog without touching any files:

```sh
pnpm release:dry-run
```

Create the release commit and tag locally:

```sh
pnpm release
```

The release script:

1. Requires a clean git working tree
2. Runs `pnpm validate` (types, lint, tests, and build)
3. Generates a CalVer version: `YYYY.MM.DD-<short-sha>`
4. Updates `CHANGELOG.md` and `package.json`
5. Creates a single release commit and a matching git tag

Push to trigger the GitHub release workflow:

```sh
git push && git push --tags
```

## Contributors

Big thanks to all the people who have already contributed!

[![contributors](https://contrib.rocks/image?repo=bruceblink/it-tools-template&refresh=1)](https://github.com/bruceblink/it-tools-template/graphs/contributors)

## License

This project is under the [GNU Affero General Public License v3.0 (AGPLv3)](LICENSE).
