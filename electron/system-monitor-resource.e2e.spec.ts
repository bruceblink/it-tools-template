import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

interface AppMetricSample {
  pid: number;
  type: string;
  name: string | null;
  serviceName: string | null;
  alive: boolean;
  cpuPercent: number | null;
  workingSetBytes: number | null;
  privateBytes: number | null;
}

interface ResourceSample {
  phase: 'baseline' | 'monitoring' | 'after-stop';
  elapsedMs: number;
  metrics: AppMetricSample[];
}

const configuredDurationMs = Number(process.env.IT_TOOLS_SYSTEM_MONITOR_SOAK_MS ?? 0);
const reportPathInput = process.env.IT_TOOLS_SYSTEM_MONITOR_RESOURCE_REPORT;
const SYSTEM_MONITOR_SERVICE_NAME = 'IT Tools System Monitor';

test('records bounded system monitor resources during an explicit soak run', async () => {
  test.skip(!Number.isInteger(configuredDurationMs) || configuredDurationMs < 30_000, 'Set IT_TOOLS_SYSTEM_MONITOR_SOAK_MS to at least 30000 to run the soak test.');
  test.setTimeout(configuredDurationMs + 180_000);

  const userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-system-monitor-resource-'));
  let electronApp: ElectronApplication | undefined;
  const startedAt = Date.now();
  const samples: ResourceSample[] = [];
  try {
    electronApp = await _electron.launch({
      args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      timeout: 60_000,
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('load');
    await expect(page.getByRole('button', { name: /Search/i })).toBeVisible({ timeout: 60_000 });

    samples.push(await collectSample(electronApp, 'baseline', startedAt));
    await runRouteCycles(page, 20);
    await expect(page.locator('[data-test-id="system-monitor-status"]')).toContainText(/Warming up|Sampling/, { timeout: 10_000 });

    const monitoringStartedAt = Date.now();
    while (Date.now() - monitoringStartedAt < configuredDurationMs) {
      samples.push(await collectSample(electronApp, 'monitoring', startedAt));
      await page.waitForTimeout(Math.min(10_000, Math.max(1_000, configuredDurationMs - (Date.now() - monitoringStartedAt))));
    }

    await gotoApp(page, 'app://bundle/');
    await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toHaveCount(0);
    const baselinePids = baselineSystemMonitorPids(samples);
    const observedUtilityPids = [...new Set(samples
      .filter(sample => sample.phase === 'monitoring')
      .flatMap(sample => sample.metrics)
      .filter(isSystemMonitorMetric)
      .map(metric => metric.pid))].sort((left, right) => left - right);
    console.info(`[system-monitor-resource] baselineSystemMonitorPids=${JSON.stringify([...baselinePids])}`);
    console.info(`[system-monitor-resource] observedSystemMonitorPids=${JSON.stringify(observedUtilityPids)}`);
    await expect.poll(async () => (await collectSystemMonitorPids(electronApp!)).every(pid => baselinePids.has(pid)), {
      timeout: 60_000,
      intervals: [250, 500, 1_000],
    }).toBe(true);
    samples.push(await collectSample(electronApp, 'after-stop', startedAt));

    const report = buildReport(samples, configuredDurationMs);
    expect(report.workload.routeCycles).toBe(20);
    expect(report.workload.durationMs).toBe(configuredDurationMs);
    expect(report.resourceCleanup.newSystemMonitorPidsAfterStop).toEqual([]);
    expect(report.resourceCleanup.hasUsableMetric).toBe(true);
    await writeReport(report);
    console.info(`[system-monitor-resource] report=${reportPathInput ?? 'test-results/system-monitor-resource-report.json'}`);
    console.info(`[system-monitor-resource] systemMonitorPids=${JSON.stringify(report.resourceCleanup.systemMonitorPidsObserved)}`);
    console.info(`[system-monitor-resource] peak=${JSON.stringify(report.peak)}`);
  }
  finally {
    await electronApp?.close().catch(() => {});
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

async function runRouteCycles(page: Page, count: number): Promise<void> {
  await gotoApp(page, 'app://bundle/system-monitor');
  await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toBeVisible();
  for (let index = 0; index < count; index += 1) {
    await gotoApp(page, 'app://bundle/');
    await gotoApp(page, 'app://bundle/system-monitor');
    await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toBeVisible();
  }
}

async function gotoApp(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url);
  }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ERR_ABORTED')) {
      throw error;
    }
  }
  await expect(page).toHaveURL(url);
}

async function collectSample(
  electronApp: ElectronApplication,
  phase: ResourceSample['phase'],
  startedAt: number,
): Promise<ResourceSample> {
  return {
    phase,
    elapsedMs: Date.now() - startedAt,
    metrics: await electronApp.evaluate(({ app }) => app.getAppMetrics().map(metric => ({
      pid: metric.pid,
      type: metric.type,
      name: metric.name ?? null,
      serviceName: metric.serviceName ?? null,
      alive: (() => {
        try {
          process.kill(metric.pid, 0);
          return true;
        }
        catch {
          return false;
        }
      })(),
      cpuPercent: metric.cpu?.percentCPUUsage ?? null,
      workingSetBytes: metric.memory?.workingSetSize ? metric.memory.workingSetSize * 1024 : null,
      privateBytes: metric.memory?.privateBytes ?? null,
    }))),
  };
}

async function collectSystemMonitorPids(electronApp: ElectronApplication): Promise<number[]> {
  return electronApp.evaluate(({ app }) => app.getAppMetrics()
    .filter(metric => metric.name === 'IT Tools System Monitor')
    .filter(metric => {
      try {
        process.kill(metric.pid, 0);
        return true;
      }
      catch {
        return false;
      }
    })
    .map(metric => metric.pid));
}

function isSystemMonitorMetric(metric: AppMetricSample): boolean {
  return metric.name === SYSTEM_MONITOR_SERVICE_NAME;
}

function baselineSystemMonitorPids(samples: readonly ResourceSample[]): Set<number> {
  return new Set(samples
    .filter(sample => sample.phase === 'baseline')
    .flatMap(sample => sample.metrics)
    .filter(isSystemMonitorMetric)
    .map(metric => metric.pid));
}

function buildReport(samples: readonly ResourceSample[], durationMs: number) {
  const baselinePids = baselineSystemMonitorPids(samples);
  const monitoringMetrics = samples.filter(sample => sample.phase === 'monitoring').flatMap(sample => sample.metrics);
  const systemMonitorMetrics = monitoringMetrics.filter(isSystemMonitorMetric);
  const systemMonitorPidsObserved = [...new Set(systemMonitorMetrics
    .map(metric => metric.pid))].sort((left, right) => left - right);
  const afterStopMetrics = samples.filter(sample => sample.phase === 'after-stop').flatMap(sample => sample.metrics);
  const afterStopPids = new Set(afterStopMetrics.filter(metric => metric.alive).map(metric => metric.pid));
  const newSystemMonitorPidsAfterStop = systemMonitorPidsObserved.filter(pid => !baselinePids.has(pid) && afterStopPids.has(pid));
  const usableMetrics = systemMonitorMetrics.filter(metric => metric.workingSetBytes !== null || metric.privateBytes !== null || metric.cpuPercent !== null);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: process.cwd(), encoding: 'utf8' }).trim().length > 0,
    },
    machine: {
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    workload: {
      routeCycles: 20,
      durationMs,
      sampleCount: samples.length,
      phases: [...new Set(samples.map(sample => sample.phase))],
    },
    peak: {
      workingSetBytes: maxMetric(systemMonitorMetrics, metric => metric.workingSetBytes),
      privateBytes: maxMetric(systemMonitorMetrics, metric => metric.privateBytes),
      cpuPercent: maxMetric(systemMonitorMetrics, metric => metric.cpuPercent),
    },
    resourceCleanup: {
      systemMonitorPidsObserved,
      baselineSystemMonitorPids: [...baselinePids].sort((left, right) => left - right),
      newSystemMonitorPidsAfterStop,
      hasUsableMetric: usableMetrics.length > 0,
    },
    samples,
  };
}

function maxMetric(metrics: readonly AppMetricSample[], read: (metric: AppMetricSample) => number | null): number | null {
  const values = metrics.map(read).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

async function writeReport(report: unknown): Promise<void> {
  const reportPath = resolve(process.cwd(), reportPathInput ?? 'test-results/system-monitor-resource-report.json');
  const relativeReportPath = relative(process.cwd(), reportPath);
  if (relativeReportPath === '..' || relativeReportPath.startsWith('..' + sep)) {
    throw new Error('The system monitor resource report path must stay inside the repository.');
  }
  await access(dirname(reportPath)).catch(() => mkdir(dirname(reportPath), { recursive: true }));
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8' });
}
