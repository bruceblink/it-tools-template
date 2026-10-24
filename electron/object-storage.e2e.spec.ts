import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  await filterPrefix(page, 'docs/');
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

  await filterPrefix(page, 'pagination/');
  await expect(page.getByTestId('storage-object')).toHaveCount(100);
  await page.getByTestId('storage-next').click();
  await expect(page.getByTestId('storage-object')).toHaveCount(5);
  await expect(page.getByTestId('storage-next')).toBeDisabled();

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
): Promise<void> {
  await page.getByTestId('storage-prefix').locator('input').fill(prefix);
  await page.getByTestId('storage-filter').click();
  await expect(page.getByTestId('storage-empty')).toHaveCount(0);
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
