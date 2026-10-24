import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const endpoint = process.env.IT_TOOLS_TEST_STORAGE_ENDPOINT ?? '';
const accessKeyId = process.env.IT_TOOLS_TEST_STORAGE_ACCESS_KEY ?? '';
const secretAccessKey = process.env.IT_TOOLS_TEST_STORAGE_SECRET_KEY ?? '';
const bucket = process.env.IT_TOOLS_TEST_STORAGE_BUCKET ?? '';
let electronApp: ElectronApplication | undefined;
let userDataDirectory = '';
let client: S3Client | undefined;

test.skip(!endpoint || !accessKeyId || !secretAccessKey || !bucket, 'requires a local S3-compatible Docker fixture');

test('connects to a local S3 bucket, pages keys, previews bounded text, and clears sessions', async () => {
  test.setTimeout(180_000);
  await seedBucket();
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-object-storage-e2e-'));
  // Isolate the app lock and profile from any desktop window the user is running.
  const bootstrap = join(userDataDirectory, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    [
      "const { app } = require('electron');",
      `app.setName(${JSON.stringify(basename(userDataDirectory))});`,
      `app.setPath('userData', ${JSON.stringify(userDataDirectory)});`,
      `app.setAppPath(${JSON.stringify(process.cwd())});`,
      `require(${JSON.stringify(resolve('out/main/main.cjs'))});`,
    ].join('\n'),
    'utf8',
  );
  electronApp = await _electron.launch({
    args: ['--no-sandbox', bootstrap],
    env: { ...process.env, APPDATA: userDataDirectory, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
  await expect(page.getByRole('button', { name: /Search/i })).toBeVisible({ timeout: 60_000 });
  await page.goto('app://bundle/object-storage');
  await expect(page.getByTestId('storage-workspace')).toBeVisible();

  await connectToBucket(page, secretAccessKey);
  await expect(page.getByTestId('storage-connection')).toContainText(bucket);
  await expect(page.getByTestId('storage-secret-key')).toHaveCount(0);
  const sessionId = await page.getByTestId('storage-connection').getAttribute('data-session-id');
  expect(sessionId).toBeTruthy();

  await filterPrefix(page, 'docs/', 5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('storage-upload-key')).toBeVisible();
  await expect(page.getByTestId('storage-prefix')).toBeVisible();
  const narrowLayout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(narrowLayout.content).toBeLessThanOrEqual(narrowLayout.viewport);
  const narrowColumns = await page.locator('.storage-table th').evaluateAll((headers) =>
    headers.map((header) => ({
      text: header.textContent?.trim(),
      width: header.clientWidth,
      contentWidth: header.scrollWidth,
    })),
  );
  expect(narrowColumns.find((column) => column.text === 'Actions')?.contentWidth).toBeLessThanOrEqual(
    narrowColumns.find((column) => column.text === 'Actions')?.width ?? 0,
  );
  expect(narrowColumns.find((column) => column.text === 'Modified')?.width).toBe(0);
  await page.screenshot({ path: test.info().outputPath('object-storage-narrow.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('storage-object')).toHaveCount(5);
  await page.getByText('docs/empty.txt', { exact: true }).click();
  await expect(page.getByTestId('storage-preview-text')).toHaveText('');
  await page.getByText('docs/unsafe.html', { exact: true }).click();
  await expect(page.getByTestId('storage-preview-text')).toContainText(
    '<script>window.__storageScriptExecuted=true</script>',
  );
  expect(
    await page.evaluate(() => (window as unknown as { __storageScriptExecuted?: boolean }).__storageScriptExecuted),
  ).toBeUndefined();
  await page.getByText('docs/large.txt', { exact: true }).click();
  await expect(page.getByTestId('storage-truncated')).toContainText('64 KiB');
  await page.getByText('docs/binary.bin', { exact: true }).click();
  await expect(page.getByTestId('storage-preview')).toContainText('Binary content');

  await filterPrefix(page, 'pagination/', 100);
  await expect(page.getByTestId('storage-object')).toHaveCount(100);
  await page.getByTestId('storage-next').click();
  await expect(page.getByTestId('storage-object')).toHaveCount(5);
  await expect(page.getByTestId('storage-next')).toBeDisabled();

  const uploadPath = join(userDataDirectory, 'upload.bin');
  const downloadPath = join(userDataDirectory, 'download.bin');
  const uploadBytes = Buffer.alloc(2 * 1024 * 1024, 73);
  await writeFile(uploadPath, uploadBytes);
  await writeFile(downloadPath, 'original target');
  await electronApp.evaluate(
    ({ dialog }, paths) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [paths.upload] }),
      });
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePath: paths.download }),
      });
      Object.defineProperty(dialog, 'showMessageBox', { configurable: true, value: async () => ({ response: 0 }) });
    },
    { upload: uploadPath, download: downloadPath },
  );
  await filterPrefix(page, 'transfers/', 0);
  await expect(page.getByTestId('storage-empty')).toBeVisible();
  await page.getByTestId('storage-upload-key').locator('input').fill('transfers/upload.bin');
  await page.getByTestId('storage-upload').click();
  await expect(page.getByTestId('storage-notice')).toContainText('Upload complete');
  await expect(page.getByTestId('storage-object')).toHaveCount(1);
  await page.getByTestId('storage-upload').click();
  await expect(page.getByTestId('storage-error')).toContainText('already exists');
  await page.getByTestId('storage-download').click();
  await expect(page.getByTestId('storage-notice')).toContainText('Download complete');
  await expect(page.getByTestId('storage-progress')).toContainText('2,097,152');
  expect(await readFile(downloadPath)).toEqual(uploadBytes);
  expect((await readdir(userDataDirectory)).filter((name) => name.endsWith('.part'))).toEqual([]);
  await page.getByTestId('storage-delete').click();
  await expect(page.getByTestId('storage-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('storage-object')).toHaveCount(1);
  await electronApp.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showMessageBox', { configurable: true, value: async () => ({ response: 1 }) });
  });
  await page.getByTestId('storage-overwrite').click();
  await writeFile(uploadPath, 'replacement content');
  await page.getByTestId('storage-upload').click();
  await expect(page.getByTestId('storage-notice')).toContainText('Upload complete');
  await page.getByTestId('storage-download').click();
  await expect(page.getByTestId('storage-notice')).toContainText('Download complete');
  expect(await readFile(downloadPath, 'utf8')).toBe('replacement content');
  await page.getByTestId('storage-delete').click();
  await expect(page.getByTestId('storage-notice')).toContainText('Object deleted');
  await expect(page.getByTestId('storage-empty')).toBeVisible();

  await page.getByTestId('storage-disconnect').click();
  await expect(page.getByTestId('storage-connect')).toBeVisible();
  const afterDisconnect = await page.evaluate(
    async (oldSessionId) =>
      window.itToolsDesktop?.listStorageObjects?.({
        sessionId: oldSessionId,
        requestId: crypto.randomUUID(),
        prefix: '',
        continuationToken: null,
      }),
    sessionId!,
  );
  expect(afterDisconnect).toEqual({ ok: false, error: 'not-connected' });

  await connectToBucket(page, 'wrong-synthetic-secret');
  await expect(page.getByTestId('storage-error')).toContainText(/Access denied|访问被拒绝/);
  await expect(page.getByTestId('storage-workspace')).not.toHaveAttribute('aria-busy', 'true');

  await page.evaluate(() => localStorage.setItem('locale', 'zh'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '对象存储', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Git 工作台', exact: true })).toBeVisible();
});

test.afterEach(async () => {
  client?.destroy();
  client = undefined;
  await electronApp?.close().catch(() => {});
  electronApp = undefined;
  if (userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    userDataDirectory = '';
  }
});

async function connectToBucket(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  secret: string,
): Promise<void> {
  await page.getByTestId('storage-endpoint').locator('input').fill(endpoint);
  await page.getByTestId('storage-region').locator('input').fill('us-east-1');
  await page.getByTestId('storage-bucket').locator('input').fill(bucket);
  await page.getByTestId('storage-access-key').locator('input').fill(accessKeyId);
  await page.getByTestId('storage-secret-key').locator('input').fill(secret);
  await page.getByTestId('storage-connect').click();
}

async function filterPrefix(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  prefix: string,
  expectedCount: number,
): Promise<void> {
  await page.getByTestId('storage-prefix').locator('input').fill(prefix);
  await page.getByTestId('storage-filter').click();
  if (expectedCount === 0) {
    await expect(page.getByTestId('storage-empty')).toBeVisible();
  } else {
    await expect(page.getByTestId('storage-object')).toHaveCount(expectedCount);
  }
}

async function seedBucket(): Promise<void> {
  client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 3,
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  const objects = [
    ['docs/readme.txt', 'Object storage fixture\n', 'text/plain'],
    ['docs/unsafe.html', '<script>window.__storageScriptExecuted=true</script>', 'text/html'],
    ['docs/large.txt', 'x'.repeat(70 * 1024), 'text/plain'],
    ['docs/binary.bin', Buffer.from([0, 1, 2, 3, 0, 255]), 'application/octet-stream'],
    ['docs/empty.txt', '', 'text/plain'],
    ...Array.from(
      { length: 105 },
      (_, index) => [`pagination/item-${String(index).padStart(3, '0')}.txt`, 'item', 'text/plain'] as const,
    ),
  ] as const;
  for (const [Key, Body, ContentType] of objects) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType }));
  }
}
