import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { analyzeHeapSnapshot } from '../scripts/heap-snapshot-analysis.mjs';
import type { HeapSnapshotAnalysis, HeapSnapshotInput } from '../scripts/heap-snapshot-analysis.mjs';

interface ListenerCounts {
  window: number;
  document: number;
}

interface WorkerLifecycle {
  created: number;
  terminated: number;
  active: number;
}

interface InstrumentedWindow extends Window {
  __workerLifecycle?: WorkerLifecycle;
}

type CdpSession = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

const conversions = [
  { path: '/toml-to-json', query: 'toml to json', label: 'Your TOML', input: (value: number) => `value = ${value}`, expected: '"value"' },
  { path: '/toml-to-yaml', query: 'toml to yaml', label: 'Your TOML', input: (value: number) => `value = ${value}`, expected: 'value:' },
  { path: '/json-to-toml', query: 'json to toml', label: 'Your JSON', input: (value: number) => `{ value: ${value} }`, expected: 'value =' },
  { path: '/yaml-to-toml', query: 'yaml to toml', label: 'Your YAML', input: (value: number) => `value: ${value}`, expected: 'value =' },
];

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test('records worker, global listener, and heap state after 20 TOML route cycles', async ({}, testInfo) => {
  test.setTimeout(120_000);
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-worker-resource-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
  await page.addInitScript(instrumentWorkers);
  await page.goto('app://bundle/toml-to-json');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Warm all route chunks before the baseline so lazy imports do not appear as retained growth.
  for (let index = 0; index < conversions.length; index += 1) {
    const conversion = conversions[index]!;
    await openConversion(page, conversion);
    await page.getByLabel(conversion.label).fill(conversion.input(index));
    await expect(page.locator('[data-test-id="area-content"]')).toContainText(conversion.expected);
    await expectWorkerIdle(page);
  }
  await openConversion(page, conversions[0]!);
  await page.evaluate(() => {
    const lifecycle = (window as InstrumentedWindow).__workerLifecycle;
    if (!lifecycle) {
      throw new Error('Worker instrumentation is unavailable.');
    }
    lifecycle.created = 0;
    lifecycle.terminated = 0;
    lifecycle.active = 0;
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const listenersBefore = await readGlobalListenerCounts(cdp);
  const heapBefore = await cdp.send('Runtime.getHeapUsage');
  const snapshotBefore = await takeHeapSnapshotSummary(cdp, undefined, 0);

  const listenerSamples: Array<{ cycle: number; counts: ListenerCounts }> = [];
  let maximumListeners = { ...listenersBefore };
  let snapshotMidRun: HeapSnapshotAnalysis | undefined;
  let heapMidRunAfterSnapshot: { usedSize: number } | undefined;
  for (let cycle = 0; cycle < 20; cycle += 1) {
    for (const conversion of conversions) {
      await openConversion(page, conversion);
      await page.getByLabel(conversion.label).fill(conversion.input(cycle));
      await expect(page.locator('[data-test-id="area-content"]')).toContainText(conversion.expected);
      await expectWorkerIdle(page);
    }

    const counts = await readGlobalListenerCounts(cdp);
    maximumListeners = {
      window: Math.max(maximumListeners.window, counts.window),
      document: Math.max(maximumListeners.document, counts.document),
    };
    listenerSamples.push({ cycle: cycle + 1, counts });

    if (cycle === 9) {
      await openConversion(page, conversions[0]!);
      await cdp.send('HeapProfiler.collectGarbage');
      snapshotMidRun = await takeHeapSnapshotSummary(cdp, snapshotBefore.nodeIds, 0);
      await cdp.send('HeapProfiler.collectGarbage');
      heapMidRunAfterSnapshot = await cdp.send('Runtime.getHeapUsage');
    }
  }

  if (!snapshotMidRun || !heapMidRunAfterSnapshot) {
    throw new Error('The worker resource run did not capture its midpoint heap snapshot.');
  }
  await openConversion(page, conversions[0]!);
  const finalListeners = await readGlobalListenerCounts(cdp);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = await cdp.send('Runtime.getHeapUsage');
  const snapshotAfter = await takeHeapSnapshotSummary(cdp, snapshotMidRun.nodeIds);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfterSnapshot = await cdp.send('Runtime.getHeapUsage');
  const lifecycle = await page.evaluate(() => (window as InstrumentedWindow).__workerLifecycle);
  const activeTaskWorkers = page.workers().filter(worker => worker.url().includes('task-runner.worker')).length;
  const heapDeltaBytes = heapAfterSnapshot.usedSize - heapBefore.usedSize;
  const heapDeltaSinceMidRunBytes = heapAfterSnapshot.usedSize - heapMidRunAfterSnapshot.usedSize;
  const retainedGrowth = compareHeapGroups(snapshotBefore.groups, snapshotAfter.groups);
  const retainedGrowthSinceMidRun = compareHeapGroups(snapshotMidRun.groups, snapshotAfter.groups);

  expect(lifecycle).toEqual({ created: 80, terminated: 80, active: 0 });
  expect(activeTaskWorkers).toBe(0);
  expect(finalListeners).toEqual(listenersBefore);
  expect(maximumListeners.window).toBeLessThanOrEqual(listenersBefore.window + 2);
  expect(maximumListeners.document).toBeLessThanOrEqual(listenersBefore.document + 2);
  expect(heapDeltaBytes).toBeLessThan(32 * 1024 * 1024);
  expect(heapDeltaSinceMidRunBytes).toBeLessThan(32 * 1024 * 1024);

  const runtime = await electronApp.evaluate(({ app }) => ({
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  }));
  const source = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
    workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: process.cwd(), encoding: 'utf8' }).trim().length > 0,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    machine: {
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    runtime,
    workload: {
      routeCycles: 20,
      routes: conversions.map(conversion => conversion.path),
      measuredWorkerTasks: 80,
      warmupWorkerTasks: conversions.length,
      returnedToStartingRoute: true,
    },
    workers: { ...lifecycle, activeTaskWorkersAfterRun: activeTaskWorkers },
    listeners: {
      measuredTargets: ['window', 'document'],
      before: listenersBefore,
      after: finalListeners,
      maximum: maximumListeners,
      samples: listenerSamples,
      media: { status: 'not-applicable', reason: 'TOML conversion routes do not request or retain media streams.' },
    },
    memory: {
      heapBeforeBytes: heapBefore.usedSize,
      heapAfterMidpointSnapshotBytes: heapMidRunAfterSnapshot.usedSize,
      heapAfterPreSnapshotBytes: heapAfter.usedSize,
      heapAfterSnapshotBytes: heapAfterSnapshot.usedSize,
      heapDeltaBytes,
      heapDeltaSinceMidRunBytes,
      thresholdBytes: 32 * 1024 * 1024,
    },
    heapSnapshots: {
      before: { nodeCount: snapshotBefore.nodeCount, selfSizeBytes: snapshotBefore.selfSizeBytes },
      midpoint: { nodeCount: snapshotMidRun.nodeCount, selfSizeBytes: snapshotMidRun.selfSizeBytes },
      after: { nodeCount: snapshotAfter.nodeCount, selfSizeBytes: snapshotAfter.selfSizeBytes },
      retention: {
        warmupNodeCount: snapshotBefore.nodeIds.size,
        matchedWarmupNodeCountAtMidpoint: snapshotMidRun.matchedBaselineNodeCount,
        newlyRetainedNodeCountAtMidpoint: snapshotMidRun.newlyRetainedNodeCount,
        midpointNodeCount: snapshotMidRun.nodeIds.size,
        matchedMidpointNodeCountAtFinal: snapshotAfter.matchedBaselineNodeCount,
        newlyRetainedNodeCountAfterMidpoint: snapshotAfter.newlyRetainedNodeCount,
      },
      largestPositiveRetainedGrowth: retainedGrowth.slice(0, 20),
      largestPositiveRetainedGrowthAfterMidpoint: retainedGrowthSinceMidRun.slice(0, 20),
      newlyRetainedGroupsAtMidpoint: snapshotMidRun.newRetainedGroups.slice(0, 20),
      newlyRetainedGroups: snapshotAfter.newRetainedGroups.slice(0, 20),
      strongRetainerPaths: snapshotAfter.retainerPaths,
    },
  };
  const reportPath = process.env.IT_TOOLS_WORKER_RESOURCE_REPORT
    ? resolve(process.cwd(), process.env.IT_TOOLS_WORKER_RESOURCE_REPORT)
    : testInfo.outputPath('worker-resource-report.json');
  const relativeReportPath = relative(process.cwd(), reportPath);
  if (relativeReportPath === '..' || relativeReportPath.startsWith('..' + sep)) {
    throw new Error('The worker resource report path must stay inside the repository.');
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.info(`[worker-resource] report=${relativeReportPath}`);
  console.info(`[worker-resource] workers=${JSON.stringify(report.workers)}`);
  console.info(`[worker-resource] listeners=${JSON.stringify({ before: listenersBefore, after: finalListeners, maximum: maximumListeners })}`);
  console.info(`[worker-resource] heapDelta=${heapDeltaBytes} bytes; snapshot nodes ${snapshotBefore.nodeCount} -> ${snapshotAfter.nodeCount}`);
  console.info(`[worker-resource] heapDeltaSinceMidpoint=${heapDeltaSinceMidRunBytes} bytes; midpoint nodes ${snapshotMidRun.nodeCount} -> ${snapshotAfter.nodeCount}`);
  console.info(`[worker-resource] retained growth=${JSON.stringify(retainedGrowth.slice(0, 10))}`);
  console.info(`[worker-resource] retained growth after midpoint=${JSON.stringify(retainedGrowthSinceMidRun.slice(0, 10))}`);
  console.info(`[worker-resource] retained objects=${JSON.stringify({ matchedMidpointNodeCount: snapshotAfter.matchedBaselineNodeCount, newlyRetainedAfterMidpoint: snapshotAfter.newlyRetainedNodeCount })}`);
  console.info(`[worker-resource] strong retainer paths=${JSON.stringify(snapshotAfter.retainerPaths)}`);
  await cdp.detach();
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

async function openConversion(targetPage: Page, conversion: (typeof conversions)[number]): Promise<void> {
  if (new URL(targetPage.url()).pathname === conversion.path) {
    return;
  }
  await targetPage.keyboard.press('Control+k');
  const search = targetPage.getByPlaceholder('Type to search a tool or a command...');
  await search.fill(conversion.query);
  await search.press('Enter');
  await expect(targetPage).toHaveURL(new RegExp(`${conversion.path.replaceAll('/', '\\/')}$`));
}

async function expectWorkerIdle(targetPage: Page): Promise<void> {
  const lifecycle = await targetPage.evaluate(() => (window as InstrumentedWindow).__workerLifecycle);
  expect(lifecycle?.active).toBe(0);
  expect(lifecycle?.created).toBe(lifecycle?.terminated);
  await expect.poll(() => targetPage.workers().filter(worker => worker.url().includes('task-runner.worker')).length).toBe(0);
}

async function readGlobalListenerCounts(cdp: CdpSession): Promise<ListenerCounts> {
  const counts: ListenerCounts = { window: 0, document: 0 };
  for (const target of ['window', 'document'] as const) {
    const evaluation = await cdp.send('Runtime.evaluate', { expression: target, returnByValue: false });
    const objectId = evaluation.result.objectId;
    if (!objectId) {
      throw new Error(`Could not observe the ${target} event target.`);
    }
    try {
      const result = await cdp.send('DOMDebugger.getEventListeners', { objectId });
      counts[target] = result.listeners.length;
    }
    finally {
      await cdp.send('Runtime.releaseObject', { objectId });
    }
  }
  return counts;
}

async function takeHeapSnapshotSummary(
  cdp: CdpSession,
  baselineNodeIds?: ReadonlySet<number>,
  maximumRetainerPaths = 12,
): Promise<HeapSnapshotAnalysis> {
  const chunks: string[] = [];
  const onChunk = (event: { chunk: string }) => chunks.push(event.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  try {
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  }
  finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  }
  if (chunks.length === 0) {
    throw new Error('The V8 heap snapshot returned no data.');
  }

  const snapshot = JSON.parse(chunks.join('')) as HeapSnapshotInput;
  return analyzeHeapSnapshot(snapshot, { baselineNodeIds, maximumRetainerPaths });
}

function compareHeapGroups(
  before: Record<string, { count: number; selfSizeBytes: number }>,
  after: Record<string, { count: number; selfSizeBytes: number }>,
): Array<{ name: string; beforeCount: number; afterCount: number; countDelta: number; beforeBytes: number; afterBytes: number; selfSizeDeltaBytes: number }> {
  const allNames = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...allNames]
    .map((name) => {
      const oldGroup = before[name] ?? { count: 0, selfSizeBytes: 0 };
      const newGroup = after[name] ?? { count: 0, selfSizeBytes: 0 };
      return {
        name,
        beforeCount: oldGroup.count,
        afterCount: newGroup.count,
        countDelta: newGroup.count - oldGroup.count,
        beforeBytes: oldGroup.selfSizeBytes,
        afterBytes: newGroup.selfSizeBytes,
        selfSizeDeltaBytes: newGroup.selfSizeBytes - oldGroup.selfSizeBytes,
      };
    })
    .filter(group => group.selfSizeDeltaBytes > 0)
    .sort((left, right) => right.selfSizeDeltaBytes - left.selfSizeDeltaBytes);
}

function instrumentWorkers(): void {
  const lifecycle: WorkerLifecycle = { created: 0, terminated: 0, active: 0 };
  Object.defineProperty(window, '__workerLifecycle', { value: lifecycle });
  const nativeWorker = window.Worker;
  window.Worker = new Proxy(nativeWorker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args) as Worker;
      if (!String(args[0]).includes('task-runner.worker')) {
        return worker;
      }
      lifecycle.created += 1;
      lifecycle.active += 1;
      let recorded = false;
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        if (!recorded) {
          recorded = true;
          lifecycle.terminated += 1;
          lifecycle.active -= 1;
        }
        terminate();
      };
      return worker;
    },
  }) as typeof Worker;
}
