import { $, argv, usePowerShell } from 'zx';
import { consola } from 'consola';
import { rawCommitsToMarkdown } from './shared/commits.mjs';
import { addToChangelog } from './shared/changelog.mjs';

if (process.platform === 'win32') {
  usePowerShell();
}

$.verbose = false;

const isDryRun = argv['dry-run'] ?? false;
const isYes = argv.yes ?? argv.y ?? false;
const skipChecks = argv['skip-checks'] ?? false;

const now = new Date();
const currentShortSha = (await $`git rev-parse --short HEAD`).stdout.trim();

const calver = now.toISOString().slice(0, 10).replace(/-/g, '.');
const version = `${calver}-${currentShortSha}`;

const { stdout: workingTreeStatus } = await $`git status --short`;

if (workingTreeStatus.trim().length > 0 && !isDryRun) {
  consola.error('Release aborted: working tree is not clean. Commit or stash changes first.');
  process.exit(1);
}

if (workingTreeStatus.trim().length > 0 && isDryRun) {
  consola.warn('[dry-run] Working tree is not clean; continuing because no files will be changed.');
}

if (!skipChecks) {
  consola.info('Running release validation (tests + build)');
  await $`pnpm validate`;
  consola.success('Release validation passed');
}

let lastTag = '';

try {
  lastTag = (await $`git describe --tags --abbrev=0`).stdout.trim();
}
catch {
  consola.warn('No existing tags found, generating changelog from all commits.');
}

const gitRange = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const { stdout: rawCommits } = await $`git log --pretty=oneline ${gitRange}`;

if (rawCommits.trim().length === 0) {
  consola.warn('No commits found since the last release.');
  process.exit(0);
}

const markdown = rawCommitsToMarkdown({ rawCommits });

consola.info(`Changelog: \n\n${markdown}\n\n`);

if (isDryRun) {
  consola.info('[dry-run] Not creating version nor tag');
  consola.info('Aborting');
  process.exit(0);
}

const shouldContinue = isYes
  ? true
  : await consola.prompt(
    'This script will update package.json, changelog, create a release commit and tag. Continue?',
    {
      type: 'confirm',
    },
  );

if (!shouldContinue) {
  consola.info('Aborting');
  process.exit(0);
}

try {
  consola.info('Updating changelog');
  await addToChangelog({ changelog: markdown, version });
  consola.success('Changelog updated');

  consola.info('Updating package version');
  await $`pnpm version ${version} --no-git-tag-version`;
  consola.success('Package version updated');

  consola.info('Creating release commit');
  await $`git add CHANGELOG.md package.json`;
  await $`git commit -m "chore(release): v${version}"`;
  consola.success('Release commit created');

  consola.info('Creating release tag');
  await $`git tag v${version}`;
  consola.success(`Release tag created: v${version}`);
} catch (error) {
  consola.error(error);
  consola.info('Aborting');
  process.exit(1);
}
