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

The development roadmap is in [Development Plan](docs/01-development-plan.md). The current scope and acceptance checks are in [Quality Baseline](docs/02-quality-baseline.md).

The two security tasks and their acceptance results are in [Random Sources and Sensitive Inputs](docs/03-security-inputs-plan.md).

Content privacy, sanitized rendering, and deployment headers are described in [Content, HTML, and Deployment Boundaries](docs/04-security-boundaries.md). The credential, request, configuration, and document inputs covered there stay in page memory; existing display and processing preferences may still be saved.

The PWA precaches the application shell and caches tool assets after use. It stores only same-origin build resources, with a 160-entry, 30-day limit for each build and service-worker scope. Offline availability depends on those resources remaining in browser storage. Build budgets, cache boundaries, and remaining performance work are documented in [Application Shell and Offline Cache](docs/05-pwa-cache-plan.md).

Every production build writes `dist/bundle-report.json` with raw and gzip sizes for the shell, optional entry dependency closures, and emitted runtime assets, including workers. Builds fail when the initial precache exceeds 8 MiB. The 300 KiB initial JavaScript and 500 KiB optional entry targets remain visible in the report; they are not yet enforced. CI uploads the report as an artifact. After building, run the focused offline acceptance with `pnpm test:e2e src/pwa-cache.e2e.spec.ts`.

The Electron Windows pilot shares the Vue interface and tool routes. Install the local Electron runtime once with `pnpm exec install-electron`, then use `pnpm electron:dev` for development, `pnpm electron:build` for the desktop build, and `pnpm electron:package:win` on Windows (or Linux with Wine) to create an NSIS installer. After building, run the Electron smoke checks with `pnpm test:e2e:electron`. The desktop renderer uses a secure local `app://` origin, does not register the Web Service Worker, and keeps Node access in a sandboxed preload bridge. Camera permission handling and Windows installation/upgrade testing remain in progress.

The feasibility and value of sharing the current web interface with an Electron desktop app are assessed in [Web and Electron Assessment](docs/06-web-electron-assessment.md).

Deployment headers are generated from `security-headers.json`. Run `pnpm headers:sync` after editing that source and `pnpm headers:check` to detect drift. A custom Plausible API requires the same exact HTTPS origin in `plausibleApiOrigin` and `VITE_PLAUSIBLE_API_HOST`; run the sync/check commands with that build variable set.

After the final production build, `pnpm headers:docker` checks real Nginx responses using local Docker on `127.0.0.1:18080` and removes its container. Start Docker and pull `nginx:stable-alpine` before running this check.

### Create a New Tool

Run the scaffold script to generate boilerplate under `src/tools/`:

```sh
pnpm run script:create:tool my-tool-name
```

This creates the directory, component, service, and registers the tool in `src/tools/index.ts`. Add it to the appropriate category and implement the logic.

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
