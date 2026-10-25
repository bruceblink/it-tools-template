import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let electronApp: ElectronApplication;
let hostPage: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-sandbox-e2e-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      IT_TOOLS_PLUGIN_SANDBOX_TEST: '1',
    },
    timeout: 60_000,
  });
  hostPage = await electronApp.firstWindow();
});

test.afterAll(async () => {
  try {
    const windows = electronApp?.windows() ?? [];
    await Promise.all(windows.map(window => window.close({ runBeforeUnload: false }).catch(() => undefined)));
    await electronApp?.close();
  }
  finally {
    if (userDataDirectory) {
      await rm(userDataDirectory, { recursive: true, force: true });
    }
  }
});

test('runs a first-party proof in a sandboxed, network-denied plugin renderer', async () => {
  const pluginOrigin = 'it-plugin://org.it-tools.sandbox-proof/';
  const peerPluginOrigin = 'it-plugin://org.it-tools.sandbox-proof-peer/';
  await expect.poll(async () => (await electronApp.windows()).some(candidate => candidate.url().startsWith(pluginOrigin))).toBe(true);
  const pluginPage = (await electronApp.windows()).find(candidate => candidate.url().startsWith(pluginOrigin));
  if (!pluginPage) {
    throw new Error('The plugin sandbox proof window did not open.');
  }
  await expect.poll(async () => (await electronApp.windows()).some(candidate => candidate.url().startsWith(peerPluginOrigin))).toBe(true);
  const peerPluginPage = (await electronApp.windows()).find(candidate => candidate.url().startsWith(peerPluginOrigin));
  if (!peerPluginPage) {
    throw new Error('The peer plugin sandbox proof window did not open.');
  }

  await expect(pluginPage.locator('#sandbox-proof')).toHaveText('Sandbox fixture loaded');
  const capabilityToast = pluginPage.getByRole('status');
  await expect(capabilityToast).toBeVisible();
  await expect(capabilityToast).toHaveCSS('position', 'fixed');
  await expect(capabilityToast).toHaveCSS('border-radius', '14px');
  await expect(pluginPage.locator('#runtime-capability-proof')).toHaveText('Available');
  await expect(pluginPage.locator('#clipboard-capability-proof')).toHaveText('Not authorized');
  await pluginPage.getByRole('button', { name: 'Dismiss capability status' }).click();
  await expect(capabilityToast).toBeHidden();
  const guardResponses: string[] = [];
  const guardErrors: string[] = [];
  pluginPage.on('response', (candidate) => {
    if (candidate.url().includes('__it_tools_internal=worker-guard')) {
      guardResponses.push(`${candidate.status()} ${candidate.url()}`);
    }
  });
  pluginPage.on('requestfailed', (candidate) => {
    if (candidate.url().includes('__it_tools_internal=worker-guard')) {
      guardErrors.push(`${candidate.url()} ${candidate.failure()?.errorText ?? ''}`);
    }
  });
  pluginPage.on('pageerror', error => guardErrors.push(error.message));
  const response = await pluginPage.reload();
  const documentHtml = await response?.text();
  expect(documentHtml).toContain('__it_tools_internal=worker-guard');
  const rendererState = await pluginPage.evaluate(() => ({
    origin: location.origin,
    secureContext: window.isSecureContext,
    node: typeof process,
    require: typeof require,
    preloadBridge: typeof window.itToolsDesktop,
  }));

  expect(rendererState.origin).toBe('it-plugin://org.it-tools.sandbox-proof');
  expect(rendererState.secureContext).toBe(true);
  expect(rendererState.node).toBe('undefined');
  expect(rendererState.require).toBe('undefined');
  expect(rendererState.preloadBridge).toBe('undefined');
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'");
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(response?.headers()['content-security-policy']).toContain("worker-src 'self'");

  let localServerRequests = 0;
  const server = createServer((_request, response) => {
    localServerRequests += 1;
    response.end('unexpected network access');
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });

  try {
    const workerProof = await pluginPage.evaluate(async (url) => {
      const ready = (worker: Worker) => new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Plugin worker did not start.')), 2_000);
        worker.addEventListener('message', (event) => {
          if (event.data === 'worker-ready') {
            clearTimeout(timeout);
            resolve(event.data);
          }
        });
        worker.addEventListener('error', (event) => {
          event.preventDefault();
          clearTimeout(timeout);
          reject(new Error('Plugin worker was blocked.'));
        }, { once: true });
      });
      const message = (worker: Worker, expected: string | string[]) => new Promise<string>((resolve, reject) => {
        const accepted = new Set(Array.isArray(expected) ? expected : [expected]);
        const timeout = setTimeout(() => reject(new Error(`Plugin worker did not return ${expected}.`)), 2_000);
        worker.addEventListener('message', (event) => {
          if (accepted.has(event.data)) {
            clearTimeout(timeout);
            resolve(event.data);
          }
        });
      });

      const first = new Worker('/worker.js');
      const workerConstructor = Worker.prototype.constructor as unknown as typeof Worker;
      const second = new workerConstructor('/worker.js');
      await Promise.all([ready(first), ready(second)]);
      let overflow: string;
      try {
        const extraWorker = new Worker('/worker.js');
        extraWorker.terminate();
        overflow = 'allowed';
      }
      catch (error) {
        overflow = error instanceof DOMException ? error.name : 'unexpected-error';
      }

      const echoPromise = message(first, 'echoed');
      first.postMessage({ kind: 'echo' });
      const echo = await echoPromise;
      const nestedPromise = message(second, ['nested-blocked', 'nested-allowed']);
      second.postMessage({ kind: 'nested' });
      const nestedWorker = await nestedPromise;
      const fetchPromise = message(second, ['network-blocked', 'network-allowed']);
      second.postMessage({ kind: 'fetch', url });
      const externalRequest = await fetchPromise;

      first.terminate();
      const replacement = new Worker('/worker.js');
      await ready(replacement);
      replacement.terminate();
      second.terminate();

      const sharedWorker = typeof SharedWorker === 'undefined'
        ? 'blocked'
        : (() => {
            try {
              const worker = new SharedWorker('/worker.js');
              worker.port.close();
              return 'allowed';
            }
            catch {
              return 'blocked';
            }
          })();
      let serviceWorker = 'unavailable';
      if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
        try {
          await navigator.serviceWorker.register('/service-worker.js');
          serviceWorker = 'allowed';
        }
        catch {
          serviceWorker = 'blocked';
        }
      }

      return {
        echo,
        overflow,
        nestedWorker,
        externalRequest,
        sharedWorker,
        serviceWorker,
        workerConstructorEscape: Object.getPrototypeOf(Worker) === null
          && Worker.prototype.constructor === Worker,
        guardInstalled: Object.prototype.hasOwnProperty.call(globalThis, '__itToolsPluginWorkerGuardInstalled'),
      };
    }, `http://127.0.0.1:${port}/probe`);

    expect({ guardResponses, guardErrors }).toEqual({
      guardResponses: [expect.stringContaining('200 ')],
      guardErrors: [],
    });
    expect(workerProof).toEqual({
      echo: 'echoed',
      overflow: 'QuotaExceededError',
      nestedWorker: 'nested-blocked',
      externalRequest: 'network-blocked',
      sharedWorker: 'blocked',
      serviceWorker: expect.stringMatching(/^(blocked|unavailable)$/),
      workerConstructorEscape: true,
      guardInstalled: true,
    });
    expect(localServerRequests).toBe(0);

    const pageFetchResult = await pluginPage.evaluate(async (url) => {
      try {
        await fetch(url);
        return 'allowed';
      }
      catch {
        return 'blocked';
      }
    }, `http://127.0.0.1:${port}/page-probe`);
    expect(pageFetchResult).toBe('blocked');
    expect(localServerRequests).toBe(0);
  }
  finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  expect(await hostPage.evaluate(() => document.readyState)).toMatch(/interactive|complete/);

  const hostPrivateFile = join(userDataDirectory, 'host-private.txt');
  await writeFile(hostPrivateFile, 'host-only test data');
  const fileUrl = pathToFileURL(hostPrivateFile).href;
  const fileReadResult = await pluginPage.evaluate(async (url) => {
    try {
      const fileResponse = await fetch(url);
      return await fileResponse.text();
    }
    catch {
      return null;
    }
  }, fileUrl);
  expect(fileReadResult).toBeNull();

  const fileNavigation = pluginPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 1_000 })
    .then(() => 'navigated')
    .catch(() => 'blocked');
  await pluginPage.evaluate((url) => window.location.assign(url), fileUrl);
  expect(await fileNavigation).toBe('blocked');
  expect(pluginPage.url()).toBe(`${pluginOrigin}index.html`);
  await expect(pluginPage.locator('#sandbox-proof')).toHaveText('Sandbox fixture loaded');

  await hostPage.evaluate(() => localStorage.setItem('sandbox-origin-isolation', 'host'));
  await pluginPage.evaluate(() => localStorage.setItem('sandbox-origin-isolation', 'plugin'));
  await expect.poll(async () => hostPage.evaluate(() => localStorage.getItem('sandbox-origin-isolation'))).toBe('host');
  expect(await pluginPage.evaluate(() => localStorage.getItem('sandbox-origin-isolation'))).toBe('plugin');
  await pluginPage.evaluate(() => localStorage.setItem('cross-plugin-isolation', 'first-plugin-data'));
  expect(await peerPluginPage.evaluate(() => localStorage.getItem('cross-plugin-isolation'))).toBeNull();
  await peerPluginPage.evaluate(() => localStorage.setItem('cross-plugin-isolation', 'peer-plugin-data'));
  expect(await pluginPage.evaluate(() => localStorage.getItem('cross-plugin-isolation'))).toBe('first-plugin-data');
  expect(await pluginPage.evaluate(() => window.open('https://example.invalid'))).toBeNull();
  expect(await pluginPage.evaluate(() => window.open('app://bundle/settings'))).toBeNull();

});
