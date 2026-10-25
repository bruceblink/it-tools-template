import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_MAX_BODY_BYTES,
  API_MAX_HEADERS_JSON_BYTES,
  API_MAX_URL_LENGTH,
} from '../src/shared/desktop-services/api';

let electronApp: ElectronApplication | undefined;
let server: Server | undefined;
let userDataDirectory = '';

test('sends bounded requests, cancels slow work, and keeps session history', async () => {
  test.setTimeout(120_000);
  const fixture = await startFixtureServer();
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-api-client-e2e-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
  await expect(page.getByRole('button', { name: /Search/i })).toBeVisible({ timeout: 60_000 });
  await page.goto('app://bundle/api-client');
  await expect(page.getByTestId('api-client-workspace')).toBeVisible();

  await page.getByTestId('api-client-url').locator('input').fill(`${fixture.baseUrl}/json`);
  await page.getByTestId('api-client-send').click();
  await expect(page.getByTestId('api-client-response-meta')).toContainText('200');
  await expect(page.getByTestId('api-client-response-body')).toContainText('hello');

  await page.getByTestId('api-client-method').selectOption('POST');
  await page.getByTestId('api-client-url').locator('input').fill(`${fixture.baseUrl}/echo`);
  await page.getByTestId('api-client-body').locator('textarea').fill('{"name":"Ada"}');
  await page.getByTestId('api-client-send').click();
  await expect(page.getByTestId('api-client-response-body')).toContainText('Ada');

  const requestCount = fixture.requestCount();
  const urlInput = page.getByTestId('api-client-url').locator('input');
  await urlInput.fill('x'.repeat(API_MAX_URL_LENGTH + 1));
  await page.getByTestId('api-client-send').click();
  await expect(page.getByTestId('api-client-error')).toHaveText('Request URL exceeds 8 KiB.');
  expect(fixture.requestCount()).toBe(requestCount);

  await urlInput.fill(`${fixture.baseUrl}/echo`);
  const headersInput = page.getByTestId('api-client-headers').locator('textarea');
  await headersInput.fill(' '.repeat(API_MAX_HEADERS_JSON_BYTES + 1));
  await page.getByTestId('api-client-send').click();
  await expect(page.getByTestId('api-client-error')).toHaveText('Request headers JSON exceeds 128 KiB.');
  expect(fixture.requestCount()).toBe(requestCount);

  await headersInput.fill('{"Accept":"application/json"}');
  await page.getByTestId('api-client-body').locator('textarea').fill('x'.repeat(API_MAX_BODY_BYTES + 1));
  await page.getByTestId('api-client-send').click();
  await expect(page.getByTestId('api-client-error')).toHaveText('Request body exceeds 256 KiB.');
  expect(fixture.requestCount()).toBe(requestCount);

  await page.getByTestId('api-client-method').selectOption('GET');
  await page.getByTestId('api-client-url').locator('input').fill(`${fixture.baseUrl}/slow`);
  await page.getByTestId('api-client-send').click();
  await expect(page.getByTestId('api-client-cancel')).toBeVisible();
  await page.getByTestId('api-client-cancel').click();
  await expect(page.getByTestId('api-client-error')).toContainText(/cancel/i);
  await expect(page.getByTestId('api-client-history-row')).toHaveCount(3);
});

test.afterEach(async () => {
  await electronApp?.close().catch(() => {});
  electronApp = undefined;
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  server = undefined;
  if (userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    userDataDirectory = '';
  }
});

async function startFixtureServer(): Promise<{ baseUrl: string; requestCount: () => number }> {
  let requests = 0;
  server = createServer((request, response) => {
    requests++;
    if (request.url === '/json') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Fixture': 'api-client' });
      response.end(JSON.stringify({ hello: 'world' }));
      return;
    }
    if (request.url === '/echo') {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        response.writeHead(201, { 'Content-Type': 'application/json' });
        response.end(Buffer.concat(chunks));
      });
      return;
    }
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('slow response');
      }, 10_000);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('The API fixture server did not expose a TCP port.');
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, requestCount: () => requests };
}
