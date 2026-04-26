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

**86 tools** across 11 categories: Crypto, Converter, Web, Images & Videos, Development, Network, Math, Measurement, Text, Data, and Favorites.

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

### Validate Before Release (tests + build)

```sh
pnpm validate
```

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
2. Runs `pnpm validate` (tests + build)
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

This project is under the [GNU GPLv3](LICENSE).
