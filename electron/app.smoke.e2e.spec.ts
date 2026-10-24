import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

type TaskWorkerLifecycle = { created: number; terminated: number; active: number };
type InstrumentedWindow = Window & { __taskWorkerLifecycle?: TaskWorkerLifecycle };

test.beforeAll(async () => {
  // Keep this test profile separate from any Electron instance the developer already has open.
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-electron-e2e-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
});

test.afterAll(async () => {
  try {
    await electronApp?.close();
  }
  finally {
    if (userDataDirectory) {
      await rm(userDataDirectory, { recursive: true, force: true });
    }
  }
});

test('starts the shared application on the secure local app origin', async () => {
  await expect(page).toHaveURL('app://bundle/');
  await expect(page).toHaveTitle(/IT Tools/i);
  expect(await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull();

  const state = await page.evaluate(async () => ({
    secureContext: window.isSecureContext,
    node: typeof process,
    require: typeof require,
    workerControlled: Boolean(navigator.serviceWorker?.controller),
    runtime: await window.itToolsDesktop!.getRuntimeInfo(),
    contentSecurityPolicy: (await fetch('/')).headers.get('content-security-policy'),
  }));

  expect(state.secureContext).toBe(true);
  expect(state.node).toBe('undefined');
  expect(state.require).toBe('undefined');
  expect(state.workerControlled).toBe(false);
  expect(state.runtime.platform).toBeTruthy();
  expect(state.runtime.version).toBeTruthy();
  expect(state.contentSecurityPolicy).toContain("script-src 'self'");
});

test('serves a shared tool route after a direct deep-link load', async () => {
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('json minify');
  await search.press('Enter');
  await expect(page).toHaveURL('app://bundle/json-minify');
  await page.reload();
  await expect(page).toHaveURL('app://bundle/json-minify');
  await expect(page.locator('#app')).not.toBeEmpty();
});

test('shows Electron-only database and system workspaces in the desktop app', async () => {
  await page.goto('app://bundle/');
  await expect(page.locator('a[href="/database-manager"]').first()).toBeVisible();
  await expect(page.locator('a[href="/system-monitor"]').first()).toBeVisible();

  await page.goto('app://bundle/database-manager');
  await expect(page.getByRole('heading', { name: 'Database manager' })).toBeVisible();
  await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();
  await expect(page.locator('.tool-layout')).toHaveClass(/tool-layout--wide/);

  await page.goto('app://bundle/system-monitor');
  await expect(page.getByRole('heading', { name: 'System monitor' })).toBeVisible();
  await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toBeVisible();
  await expect(page.locator('.tool-layout')).toHaveClass(/tool-layout--wide/);
});

test('loads advanced Math.js functions lazily from the app protocol', async () => {
  await page.goto('app://bundle/math-evaluator');

  const input = page.getByTestId('math-expression');
  const output = page.getByTestId('math-result');
  await input.fill('2 cm to mm');
  await expect(output).toHaveText('20 mm');
});

test('renders Markdown in a dedicated worker on the app protocol', async () => {
  await page.goto('app://bundle/markdown-to-html');

  const input = page.getByTestId('markdown-input');
  const output = page.getByTestId('area-content');
  await input.fill('# Desktop\n\n**worker** <script>window.__markdownScriptExecuted=true</script>');
  await expect(output).toContainText('<h1>Desktop</h1>');
  await expect(output).toContainText('&lt;script&gt;window.__markdownScriptExecuted=true&lt;/script&gt;');
  expect(await page.evaluate(() => (window as Window & { __markdownScriptExecuted?: boolean }).__markdownScriptExecuted)).toBeUndefined();

  await input.fill('x'.repeat(256 * 1024 + 1));
  await expect(page.getByRole('alert')).toHaveText('Task limits exceeded. Reduce the input.');
  await expect(output).toHaveText('');
});

test('converts CSV to Markdown in a worker on the app protocol', async () => {
  await page.goto('app://bundle/csv-to-markdown-table');

  const input = page.getByTestId('input');
  const output = page.getByTestId('area-content');
  await input.fill('name,age\nAlice,30');
  await expect(output).toContainText('| name | age |');
  await expect(output).toContainText('| Alice | 30 |');

  await input.fill('"unterminated');
  await expect(page.getByText('Provided CSV is not valid.', { exact: true })).toBeVisible();
  await expect(output).toHaveText('');
});

test('converts Docker Run to Compose in a dedicated worker on the app protocol', async () => {
  await page.goto('app://bundle/docker-run-to-docker-compose-converter');

  const input = page.getByTestId('docker-run-command');
  const output = page.getByTestId('area-content');
  await input.fill('docker run --name web -p 8080:80 --restart always nginx');
  await expect(output).toContainText('image: nginx');
  await expect(output).toContainText("- '8080:80'");

  await input.fill('docker run --rm --gpus all --name worker image:tag');
  await expect(page.getByText('The option "--rm" could not be translated to docker-compose.yml.', { exact: true })).toBeVisible();
  await expect(page.getByText('The option "--gpus" is not yet implemented.', { exact: true })).toBeVisible();
});

test('reads Electron runtime details through the shared platform adapter', async () => {
  await page.goto('app://bundle/device-information');

  const runtimeRow = page.locator('.information').filter({ has: page.getByText('Runtime', { exact: true }) });
  const platformRow = page.locator('.information').filter({ has: page.getByText('Runtime platform', { exact: true }) });
  const versionRow = page.locator('.information').filter({ has: page.getByText('Runtime version', { exact: true }) });

  await expect(runtimeRow).toContainText('electron');
  await expect(platformRow).toContainText(process.platform);
  await expect(versionRow).not.toContainText('unknown');
});

test('migrates and persists first-party extension settings on the app origin', async () => {
  await page.addInitScript(() => {
    const key = 'it-tools.extension-setting.v1:org.it-tools.data-conversion:org.it-tools.data-conversion%2Fmax-records';
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify(24.8));
    }
  });
  await page.reload();
  await page.goto('app://bundle/settings');

  const maxRecords = page.getByRole('textbox', { name: 'Maximum JSON Lines records' });
  await expect(maxRecords).toHaveValue('24');
  await expect(page.getByText('This saved value was upgraded to the current setting version.')).toBeVisible();

  await maxRecords.fill('140');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText('Setting saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Maximum JSON Lines records' })).toHaveValue('140');
});

test('loads the Electron plugin manager through the trusted desktop bridge', async () => {
  await page.goto('app://bundle/settings');
  await expect(page.getByRole('heading', { name: 'Electron plugin packages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install signed package' })).toBeVisible();
  await expect(page.getByText('No external plugin packages are installed.')).toBeVisible();

  const results = await page.evaluate(async () => ({
    plugins: await window.itToolsDesktop!.listPlugins!(),
    signers: await window.itToolsDesktop!.listTrustedPluginSigners!(),
  }));
  expect(results.plugins).toMatchObject({ ok: true, value: [] });
  expect(results.signers).toMatchObject({ ok: true, value: [] });
});

test('runs text and regex tasks in the worker on the app origin', async () => {
  await page.goto('app://bundle/text-diff');
  await page.getByLabel('Modified text').fill('desktop worker result');
  await expect(page.locator('.diff-added')).toContainText('desktop worker result');

  await page.goto('app://bundle/json-minify');
  await page.getByLabel('Your raw JSON').fill('{ "desktop": true }');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('{"desktop":true}');

  await page.goto('app://bundle/csv-to-json');
  await page.getByLabel('Your CSV').fill('name,age\nAlice,30');
  await expect(page.locator('[data-test-id="area-content"]')).toContainText('"name": "Alice"');

  await page.goto('app://bundle/json-to-csv');
  await page.getByLabel('Your raw JSON').fill('[{ name: "Alice", age: 30 }]');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('name,age\nAlice,30');

  await page.goto('app://bundle/json-lines-converter');
  await page.getByLabel('Your JSON Lines').fill('{"desktop":true}');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('[\n  {\n    "desktop": true\n  }\n]');

  await page.goto('app://bundle/xml-formatter');
  await page.getByLabel('Your XML').fill('<foo><bar>desktop</bar></foo>');
  await expect(page.locator('[data-test-id="area-content"]')).toContainText('<bar>desktop</bar>');

  await page.goto('app://bundle/xml-to-json');
  await page.getByLabel('Your XML content').fill('<foo><bar>desktop</bar></foo>');
  await expect(page.locator('[data-test-id="area-content"]')).toContainText('"_text": "desktop"');

  await page.goto('app://bundle/json-to-xml');
  await page.getByLabel('Your JSON content').fill('{ foo: { _attributes: { id: 1 }, _text: "desktop" } }');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('<foo id="1">desktop</foo>');

  await page.goto('app://bundle/yaml-to-json-converter');
  await page.getByLabel('Your YAML').fill('foo: desktop');
  await expect(page.locator('[data-test-id="area-content"]')).toContainText('"foo": "desktop"');

  await page.goto('app://bundle/json-to-yaml-converter');
  await page.getByLabel('Your JSON').fill('{ foo: "desktop" }');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('foo: desktop');

  await page.goto('app://bundle/toml-to-json');
  await page.getByLabel('Your TOML').fill('foo = "desktop"');
  await expect(page.locator('[data-test-id="area-content"]')).toContainText('"foo": "desktop"');

  await page.goto('app://bundle/toml-to-yaml');
  await page.getByLabel('Your TOML').fill('foo = "desktop"');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('foo: desktop');

  await page.goto('app://bundle/json-to-toml');
  await page.getByLabel('Your JSON').fill('{ foo: "desktop" }');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('foo = "desktop"');

  await page.goto('app://bundle/yaml-to-toml');
  await page.getByLabel('Your YAML').fill('foo: desktop');
  await expect(page.locator('[data-test-id="area-content"]')).toHaveText('foo = "desktop"');

  await page.goto('app://bundle/regex-tester');
  await page.getByLabel('Regex to test:').fill('worker');
  await page.getByLabel('Text to match:').fill('worker task');
  await expect(page.locator('table')).toContainText('worker');
});

test('loads a selected locale on demand and restores it after reload', async () => {
  await page.goto('app://bundle/regex-tester');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Regex Tester');

  const language = page.locator('.c-select').first();
  await language.locator('.c-select-input').click();
  await language.getByText('中文', { exact: true }).click();
  await expect(heading).not.toHaveText('Regex Tester');
  const translatedTitle = await heading.innerText();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(translatedTitle);
  await expect(page.locator('.c-select-input').first()).toContainText('中文');

  await language.locator('.c-select-input').click();
  await language.getByText('English', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regex Tester');
});

test('keeps the Markdown print window isolated with Node disabled', async () => {
  await page.getByRole('button', { name: /Search/ }).click();
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('markdown to html');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/markdown-to-html$/);

  // Prevent Chromium's print dialog from blocking the renderer during this smoke test.
  await page.evaluate(() => {
    const originalOpen = window.open;
    window.open = ((...args: Parameters<typeof window.open>) => {
      const popup = originalOpen.apply(window, args);
      if (popup) {
        Object.defineProperty(popup, 'print', { value: () => {}, configurable: true });
      }
      return popup;
    }) as typeof window.open;
  });

  const popupPromise = electronApp.waitForEvent('window');
  await page.getByRole('button', { name: 'Print as PDF' }).click();
  const popup = await popupPromise;

  const popupState = await popup.evaluate(() => ({
    node: typeof process,
    require: typeof require,
    bridge: typeof window.itToolsDesktop,
  }));
  expect(popupState).toEqual({ node: 'undefined', require: 'undefined', bridge: 'object' });
  await popup.close();
});

test('terminates each TOML conversion worker through 20 route cycles', async () => {
  // Hosted Windows runners can take longer to complete the repeated route
  // navigations while still exercising the same worker lifecycle assertions.
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const lifecycle: TaskWorkerLifecycle = { created: 0, terminated: 0, active: 0 };
    Object.defineProperty(window, '__taskWorkerLifecycle', { value: lifecycle });
    const nativeWorker = window.Worker;
    window.Worker = new Proxy(nativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (!String(args[0]).includes('task-runner.worker')) {
          return worker;
        }
        lifecycle.created++;
        lifecycle.active++;
        let recorded = false;
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          if (!recorded) {
            recorded = true;
            lifecycle.terminated++;
            lifecycle.active--;
          }
          terminate();
        };
        return worker;
      },
    }) as typeof Worker;
  });
  await page.goto('app://bundle/toml-to-json');

  const conversions = [
    { path: '/toml-to-json', query: 'toml to json', label: 'Your TOML', input: (value: number) => `value = ${value}`, expected: '"value"' },
    { path: '/toml-to-yaml', query: 'toml to yaml', label: 'Your TOML', input: (value: number) => `value = ${value}`, expected: 'value:' },
    { path: '/json-to-toml', query: 'json to toml', label: 'Your JSON', input: (value: number) => `{ value: ${value} }`, expected: 'value =' },
    { path: '/yaml-to-toml', query: 'yaml to toml', label: 'Your YAML', input: (value: number) => `value: ${value}`, expected: 'value =' },
  ];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = await cdp.send('Runtime.getHeapUsage');

  for (let cycle = 0; cycle < 20; cycle++) {
    for (const conversion of conversions) {
      if (!page.url().endsWith(conversion.path)) {
        await page.keyboard.press('Control+k');
        const search = page.getByPlaceholder('Type to search a tool or a command...');
        await search.fill(conversion.query);
        await search.press('Enter');
        await expect(page).toHaveURL(new RegExp(`${conversion.path.replaceAll('/', '\\/')}$`));
      }
      await page.getByLabel(conversion.label).fill(conversion.input(cycle));
      await expect(page.locator('[data-test-id="area-content"]')).toContainText(conversion.expected);
      const lifecycle = await page.evaluate(() => (window as InstrumentedWindow).__taskWorkerLifecycle);
      expect(lifecycle?.active).toBe(0);
      expect(lifecycle?.created).toBe(lifecycle?.terminated);
      await expect.poll(() => page.workers().filter(worker => worker.url().includes('task-runner.worker')).length).toBe(0);
    }
    if ((cycle + 1) % 5 === 0) {
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      console.info(`[worker-lifecycle] completed ${cycle + 1}/20 cycles; used heap ${heap.usedSize} bytes`);
    }
  }

  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = await cdp.send('Runtime.getHeapUsage');
  const lifecycle = await page.evaluate(() => (window as InstrumentedWindow).__taskWorkerLifecycle);
  expect(lifecycle).toEqual({ created: 80, terminated: 80, active: 0 });
  expect(heapAfter.usedSize - heapBefore.usedSize).toBeLessThan(32 * 1024 * 1024);
  console.info(`[worker-lifecycle] heap delta after GC: ${heapAfter.usedSize - heapBefore.usedSize} bytes`);
  await cdp.detach();
});
