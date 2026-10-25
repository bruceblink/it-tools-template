import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
let electronApp: ElectronApplication | undefined;
let userDataDirectory = '';
let repositoryDirectory = '';

test('opens a local repository and reads status, history, and diff', async () => {
  test.setTimeout(120_000);
  repositoryDirectory = await createFixtureRepository();
  const expectedRepositoryPath = await realpath(repositoryDirectory);
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-git-workbench-e2e-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
  await expect(page.getByRole('button', { name: /Search/i })).toBeVisible({ timeout: 60_000 });
  await page.goto('app://bundle/git-workbench');
  await expect(page.getByTestId('git-workbench')).toBeVisible();

  await setFileDialogResult({ canceled: false, filePaths: [repositoryDirectory] });
  await page.getByTestId('git-workbench-select').click();
  await expect(page.getByTestId('git-workbench-repository').locator('code')).toHaveText(expectedRepositoryPath);
  await expect(page.getByTestId('git-workbench-status')).toContainText('README.md');
  await expect(page.getByTestId('git-workbench-status')).toContainText('notes.txt');
  await expect(page.getByTestId('git-workbench-log')).toContainText('initial commit');
  await expect(page.getByTestId('git-workbench-diff-body')).toContainText('changed line');
  await expect(page.getByTestId('git-workbench-repository')).toContainText('main');
});

test.afterEach(async () => {
  await electronApp?.close().catch(() => {});
  electronApp = undefined;
  if (userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    userDataDirectory = '';
  }
  if (repositoryDirectory) {
    await rm(repositoryDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    repositoryDirectory = '';
  }
});

async function createFixtureRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-git-fixture-'));
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'README.md'), '# Git fixture\nbase line\n', 'utf8');
  await writeFile(join(directory, 'src', 'main.ts'), 'export const value = 1;\n', 'utf8');
  await run('git', ['init'], { cwd: directory });
  await run('git', ['branch', '-M', 'main'], { cwd: directory });
  await run('git', ['config', 'user.name', 'IT Tools Test'], { cwd: directory });
  await run('git', ['config', 'user.email', 'it-tools-test@example.invalid'], { cwd: directory });
  await run('git', ['add', '.'], { cwd: directory });
  await run('git', ['commit', '-m', 'initial commit'], { cwd: directory });
  await writeFile(join(directory, 'README.md'), '# Git fixture\nchanged line\n', 'utf8');
  await writeFile(join(directory, 'notes.txt'), 'untracked note\n', 'utf8');
  const readme = await readFile(join(directory, 'README.md'), 'utf8');
  if (!readme.includes('changed line')) {
    throw new Error('The Git fixture was not written.');
  }
  return directory;
}

async function setFileDialogResult(result: { canceled: boolean; filePaths: string[] }): Promise<void> {
  await electronApp?.evaluate(({ dialog }, nextResult) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => nextResult,
    });
  }, result);
}
