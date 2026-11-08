# Repository Workflow

- After each independently acceptable feature passes its required validation, create one focused commit before starting another feature.
- Stage only changes that belong to that feature. Exclude unrelated and unfinished changes. If a file contains unrelated edits, stage only the relevant hunks.
- Use a concise Conventional Commit title scoped to the feature.
- Do not push unless the user requests it or the repository workflow requires it.

## Project Architecture

- The web and desktop entries share the Vue application in `src/app.ts`. Tool metadata and the registry control routes, platform visibility, capabilities, and loading.
- Keep browser operations behind `src/platform-adapter/`. Desktop-only operations cross the preload bridge and IPC into the corresponding main-process service in `electron/`; do not import desktop drivers into the web build.
- First-party extensions run as trusted application code. External signed plugins run only in isolated desktop windows and require separate signer trust and capability approval.
- The plugin marketplace discovers public GitHub repositories. It does not host plugin packages; installation uses the desktop host and its package verification.
- Keep tool input private by default. Preserve the documented data-processing, storage, and network boundaries when changing a tool.

## Product And Design

- Preserve the existing tool catalog, URLs, favorites, platform availability, and workbench workflows unless a request explicitly changes them.
- Design for repeated development work: use consistent typography, spacing, control states, and responsive layouts without replacing functional views with marketing pages.
- Use “desktop” or “桌面” in product-facing titles and descriptions. Retain `Electron` where it identifies a command, package, API, file, runtime, or implementation boundary.
- Prefer shared UI components and theme values. Check both light and dark themes, keyboard focus, narrow widths, and real desktop windows for affected user-facing changes.

## Documentation

- `README.md` is the entry point for features, development commands, and architecture. `docs/01-development-plan.md` is the only development plan; the other documents in `docs/` describe technical interfaces and design boundaries.
- Update the README and relevant technical documents when architecture, supported behavior, developer commands, or security boundaries change. Do not turn technical reference documents into a second roadmap.
- Verify changed Markdown links, UTF-8, LF line endings, and `git diff --check`. Describe unverified behavior and platform limits explicitly.
