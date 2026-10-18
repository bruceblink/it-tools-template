import { _electron, chromium } from '@playwright/test';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { calculateIdleCpuPercent, collectProcessTree } from './host.mjs';

const idleWindowMs = 3000;
const palettePlaceholder = 'Type to search a tool or a command...';
export const routeCases = [
  { id: 'jsonMinify', path: '/json-minify', query: 'JSON minify', ready: 'json' },
  { id: 'regexTester', path: '/regex-tester', query: 'Regex Tester', ready: 'regex' },
  { id: 'macLookup', path: '/mac-address-lookup', query: 'MAC address lookup', ready: 'mac' },
  { id: 'textDiff', path: '/text-diff', query: 'Text diff', ready: 'diff' },
  { id: 'pdfSignatureChecker', path: '/pdf-signature-checker', query: 'PDF signature checker', ready: 'pdf' },
  { id: 'mathEvaluator', path: '/math-evaluator', query: 'Math evaluator', ready: 'math' },
  { id: 'rsaKeyPairGenerator', path: '/rsa-key-pair-generator', query: 'RSA key pair generator', ready: 'rsa' },
  { id: 'cameraRecorder', path: '/camera-recorder', query: 'Camera recorder', ready: 'heading' },
];

export function buildJsonWorkloads(sha256) {
  return [
    { name: 'small', count: 12, valueLength: 40 },
    { name: 'large', count: 300, valueLength: 64 },
    { name: 'stress', count: 600, valueLength: 72 },
  ].map((configuration) => {
    const items = Array.from({ length: configuration.count }, (_, index) => ({
      id: index,
      label: 'record-' + index,
      value: 'x'.repeat(configuration.valueLength),
    }));
    const input = JSON.stringify({ items }, null, 2);
    const expected = JSON.stringify({ items });
    return {
      name: configuration.name,
      input,
      inputBytes: Buffer.byteLength(input),
      outputBytes: Buffer.byteLength(expected),
      outputSha256: sha256(expected),
    };
  });
}

export const regexWorkload = {
  name: 'large-safe-mismatch',
  pattern: '^Z$',
  text: 'A'.repeat(256 * 1024),
};
export const mathWorkload = {
  name: 'sum-200-values',
  expression: 'sum([' + Array.from({ length: 200 }, () => '1').join(',') + '])',
  result: '200',
};

function briefError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0].slice(0, 240);
}

async function waitForRouteReady(page, route) {
  let stage = 'route URL';
  try {
    await page.waitForURL(url => url.pathname === route.path, { timeout: 60_000 });
    stage = 'tool heading';
    await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 60_000 });
    stage = 'tool control: ' + route.ready;
    if (route.ready === 'json') {
      await page.locator('[data-test-id="input"]').waitFor({ state: 'visible' });
    }
    else if (route.ready === 'regex') {
      await page.getByPlaceholder('Put the regex to test').waitFor({ state: 'visible' });
    }
    else if (route.ready === 'mac') {
      await page.getByPlaceholder('Type a MAC address').waitFor({ state: 'visible' });
    }
    else if (route.ready === 'diff') {
      await page.getByLabel('Original text').waitFor({ state: 'visible' });
    }
    else if (route.ready === 'pdf') {
      await page.getByText('Drag and drop a PDF file here, or click to select a file').waitFor({ state: 'visible' });
    }
    else if (route.ready === 'math') {
      await page.getByPlaceholder(/Your math expression/).waitFor({ state: 'visible' });
    }
    else if (route.ready === 'rsa') {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('[data-test-id="area-content"]'))
          .some(element => element.textContent?.includes('BEGIN PUBLIC KEY')),
        undefined,
        { timeout: 90_000 },
      );
    }
    stage = 'paint after tool load';
    await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  }
  catch (error) {
    throw new Error('Route ready ' + route.id + ' (' + stage + '): ' + briefError(error));
  }
}

async function reloadRenderer(page, route) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: /Search/i }).waitFor({ state: 'visible', timeout: 60_000 });
  await waitForRouteReady(page, route);
}

async function openTool(page, route) {
  const started = performance.now();
  let stage = 'open palette';
  try {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    stage = 'wait for search field';
    const search = page.getByPlaceholder(palettePlaceholder);
    await search.waitFor({ state: 'visible' });
    stage = 'fill search field';
    await search.fill(route.query);
    stage = 'find matching result';
    const matchingOption = page.locator('.palette-modal [role="option"]').filter({ hasText: new RegExp(route.query, 'i') }).first();
    await matchingOption.waitFor({ state: 'visible', timeout: 30_000 });
    stage = 'select matching result';
    await matchingOption.click();
    stage = 'wait for tool page';
    await waitForRouteReady(page, route);
  }
  catch (error) {
    throw new Error('Route ' + route.id + ' (' + stage + '): ' + briefError(error));
  }
  return Math.round((performance.now() - started) * 100) / 100;
}

async function measureJsonInputs(page, workloads) {
  const input = page.locator('[data-test-id="input"]');
  const records = [];
  for (const workload of workloads) {
    let stage = 'fill input';
    try {
      const started = performance.now();
      await input.fill(workload.input, { timeout: 60_000 });
      stage = 'wait for transformed output';
      await page.waitForFunction(
        expectedLength => {
          const output = document.querySelector('[data-test-id="area-content"]');
          return (output?.textContent ?? '').length === expectedLength;
        },
        workload.outputBytes,
        { timeout: 60_000 },
      );
      records.push({
        name: workload.name,
        inputBytes: workload.inputBytes,
        outputBytes: workload.outputBytes,
        outputSha256: workload.outputSha256,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
      await reloadRenderer(page, { id: 'jsonMinify', path: '/json-minify', ready: 'json' });
    }
    catch (error) {
      throw new Error('JSON workload ' + workload.name + ' (' + stage + '): ' + briefError(error));
    }
  }
  return records;
}

async function measureRegexInput(page) {
  let stage = 'fill pattern';
  try {
    await page.getByPlaceholder('Put the regex to test').fill(regexWorkload.pattern);
    const input = page.getByPlaceholder('Put the text to match');
    const started = performance.now();
    stage = 'fill match text';
    await input.fill(regexWorkload.text, { timeout: 60_000 });
    await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    return {
      name: regexWorkload.name,
      pattern: regexWorkload.pattern,
      inputBytes: Buffer.byteLength(regexWorkload.text),
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      riskPolicy: 'linear anchored literal mismatch; catastrophic-backtracking patterns are excluded',
    };
  }
  catch (error) {
    throw new Error('Regex workload (' + stage + '): ' + briefError(error));
  }
}

async function measureMathInput(page) {
  let stage = 'fill expression';
  try {
    const input = page.getByPlaceholder(/Your math expression/);
    const started = performance.now();
    await input.fill(mathWorkload.expression);
    stage = 'wait for evaluated result';
    await page.waitForFunction(
      expected => Array.from(document.querySelectorAll('.tool-content .c-card'))
        .some(card => card.textContent?.replace(/\s+/g, ' ').trim() === 'Result ' + expected),
      mathWorkload.result,
    );
    await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    return {
      name: mathWorkload.name,
      inputBytes: Buffer.byteLength(mathWorkload.expression),
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    };
  }
  catch (error) {
    throw new Error('Math workload (' + stage + '): ' + briefError(error));
  }
}

async function collectRendererHeap(page) {
  return page.evaluate(() => {
    const memory = performance.memory;
    if (!memory) {
      return null;
    }
    return {
      usedBytes: memory.usedJSHeapSize,
      totalBytes: memory.totalJSHeapSize,
      limitBytes: memory.jsHeapSizeLimit,
    };
  });
}

async function collectElectronMetrics(electronApp) {
  return electronApp.evaluate(({ app }) => app.getAppMetrics().map(metric => ({
    pid: metric.pid,
    type: metric.type,
    cpuPercentSincePreviousSnapshot: metric.cpu?.percentCPUUsage ?? null,
    workingSetKb: metric.memory?.workingSetSize ?? null,
    privateBytes: metric.memory?.privateBytes ?? null,
    sharedBytes: metric.memory?.sharedBytes ?? null,
  })));
}

async function runToolSuite(page, workloads) {
  const firstOpen = {};
  const warmOpen = {};
  const interactions = {};
  for (const route of routeCases) {
    firstOpen[route.id] = await openTool(page, route);
  }
  for (const route of routeCases) {
    warmOpen[route.id] = await openTool(page, route);
  }
  const jsonRoute = routeCases.find(route => route.id === 'jsonMinify');
  const regexRoute = routeCases.find(route => route.id === 'regexTester');
  const mathRoute = routeCases.find(route => route.id === 'mathEvaluator');
  if (!jsonRoute || !regexRoute || !mathRoute) {
    throw new Error('A required interaction route is missing from the baseline cases.');
  }
  await openTool(page, mathRoute);
  interactions.mathEvaluation = await measureMathInput(page);
  await reloadRenderer(page, mathRoute);
  await openTool(page, jsonRoute);
  interactions.jsonTransform = await measureJsonInputs(page, workloads);
  await openTool(page, regexRoute);
  interactions.regexMatch = await measureRegexInput(page);
  await reloadRenderer(page, regexRoute);
  return { firstOpen, warmOpen, interactions };
}

export async function runWebSample(index, options, baseUrl, workloads) {
  let browserServer;
  let browser;
  let context;
  try {
    const started = performance.now();
    browserServer = await chromium.launchServer({
      executablePath: options.chromeExecutable,
      headless: true,
      args: [
        '--enable-precise-memory-info',
        '--disable-background-networking',
        '--disable-component-update',
        '--no-first-run',
        '--lang=en-US',
      ],
    });
    browser = await chromium.connect(browserServer.wsEndpoint());
    context = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem('locale', 'en'));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: /Search/i }).waitFor({ state: 'visible', timeout: 60_000 });
    const startupMs = Math.round((performance.now() - started) * 100) / 100;
    const browserVersion = browser.version();
    const suite = await runToolSuite(page, workloads);
    const rendererHeap = await collectRendererHeap(page);
    const processId = browserServer.process()?.pid;
    const processBeforeIdle = collectProcessTree(processId);
    const idleStarted = performance.now();
    await page.waitForTimeout(idleWindowMs);
    const processAfterIdle = collectProcessTree(processId);
    const idleElapsedMs = performance.now() - idleStarted;
    return {
      iteration: index,
      startupMs,
      browserVersion,
      routeOpenMs: suite,
      rendererHeap,
      processGroup: {
        rootPid: processId,
        beforeIdle: processBeforeIdle,
        afterIdle: processAfterIdle,
        idleWindowMs: Math.round(idleElapsedMs),
        normalizedIdleCpuPercent: calculateIdleCpuPercent(processBeforeIdle, processAfterIdle, idleElapsedMs, cpus().length),
      },
    };
  }
  finally {
    await context?.close().catch(() => {});
    await browserServer?.close().catch(() => {});
  }
}

export async function runElectronSample(index, options, tempRoot, workloads) {
  const profilePath = join(tempRoot, 'electron-profile-' + String(index).padStart(2, '0'));
  let electronApp;
  try {
    const started = performance.now();
    electronApp = await _electron.launch({
      executablePath: options.electronExecutable,
      args: ['--user-data-dir=' + profilePath, '--lang=en-US'],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      timeout: 90_000,
    });
    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(60_000);
    await page.getByRole('button', { name: /Search/i }).waitFor({ state: 'visible', timeout: 90_000 });
    const startupMs = Math.round((performance.now() - started) * 100) / 100;
    const runtimeVersions = await electronApp.evaluate(({ app }) => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? null,
      electronChrome: process.versions.chrome ?? null,
      electronNode: process.versions.node ?? null,
    }));
    const suite = await runToolSuite(page, workloads);
    const rendererHeap = await collectRendererHeap(page);
    const processId = electronApp.process().pid;
    const electronMetricsBeforeIdle = await collectElectronMetrics(electronApp);
    const processBeforeIdle = collectProcessTree(processId);
    const idleStarted = performance.now();
    await page.waitForTimeout(idleWindowMs);
    const electronMetricsAfterIdle = await collectElectronMetrics(electronApp);
    const processAfterIdle = collectProcessTree(processId);
    const idleElapsedMs = performance.now() - idleStarted;
    return {
      iteration: index,
      startupMs,
      ...runtimeVersions,
      routeOpenMs: suite,
      rendererHeap,
      electronMetricsBeforeIdle,
      electronMetricsAfterIdle,
      processGroup: {
        rootPid: processId,
        beforeIdle: processBeforeIdle,
        afterIdle: processAfterIdle,
        idleWindowMs: Math.round(idleElapsedMs),
        normalizedIdleCpuPercent: calculateIdleCpuPercent(processBeforeIdle, processAfterIdle, idleElapsedMs, cpus().length),
      },
    };
  }
  finally {
    await electronApp?.close().catch(() => {});
  }
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) {
    return { samples: 0, median: null, p95: null };
  }
  const percentile = fraction => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return {
    samples: sorted.length,
    median: rounded(median),
    p95: rounded(percentile(0.95)),
  };
}

export function summarizePlatform(samples, workloads) {
  const metrics = {
    startupMs: summarize(samples.map(sample => sample.startupMs)),
    normalizedIdleCpuPercent: summarize(samples.map(sample => sample.processGroup.normalizedIdleCpuPercent)),
    workingSetBytes: summarize(samples.map(sample => sample.processGroup.afterIdle.workingSetBytes)),
    privateBytes: summarize(samples.map(sample => sample.processGroup.afterIdle.privateBytes)),
    rendererHeapUsedBytes: summarize(samples.map(sample => sample.rendererHeap?.usedBytes)),
    toolFirstOpenMs: {},
    toolWarmOpenMs: {},
    interactions: {},
  };
  for (const route of routeCases) {
    metrics.toolFirstOpenMs[route.id] = summarize(samples.map(sample => sample.routeOpenMs.firstOpen[route.id]));
    metrics.toolWarmOpenMs[route.id] = summarize(samples.map(sample => sample.routeOpenMs.warmOpen[route.id]));
  }
  for (const workload of workloads) {
    metrics.interactions['json.' + workload.name] = summarize(samples.map((sample) => {
      const record = sample.routeOpenMs.interactions.jsonTransform.find(item => item.name === workload.name);
      return record?.durationMs;
    }));
  }
  metrics.interactions.regexMatch = summarize(samples.map(sample => sample.routeOpenMs.interactions.regexMatch.durationMs));
  metrics.interactions.mathEvaluation = summarize(samples.map(sample => sample.routeOpenMs.interactions.mathEvaluation.durationMs));
  return metrics;
}
