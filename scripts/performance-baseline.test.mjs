import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShortStatusPaths } from './performance-baseline/host.mjs';
import { routeCases, summarizePlatform } from './performance-baseline/runtime.mjs';

test('preserves the first character of paths in git short status output', () => {
  assert.deepEqual(
    parseShortStatusPaths(' M scripts/performance-baseline.test.mjs\r\n?? docs/performance-report.json'),
    ['scripts/performance-baseline.test.mjs', 'docs/performance-report.json'],
  );
  assert.deepEqual(parseShortStatusPaths(''), []);
});

function makeSample({ inputFillMs, outputUpdateMs, durationMs, inputEventMs, inputEventOutputUpdateMs }) {
  const routeTimings = Object.fromEntries(routeCases.map(route => [route.id, 100]));
  return {
    startupMs: 100,
    processGroup: {
      normalizedIdleCpuPercent: 0.25,
      afterIdle: { workingSetBytes: 500, privateBytes: 400 },
    },
    rendererHeap: { usedBytes: 300 },
    routeOpenMs: {
      firstOpen: routeTimings,
      warmOpen: routeTimings,
      interactions: {
        jsonTransform: [{ name: 'stress', inputFillMs, outputUpdateMs, durationMs, inputEventMs, inputEventOutputUpdateMs }],
        regexMatch: { durationMs: 50 },
        mathEvaluation: { durationMs: 60 },
      },
    },
  };
}

test('summarizes JSON fill, bulk input event, and output update timings separately', () => {
  const summary = summarizePlatform([
    makeSample({ inputFillMs: 40, outputUpdateMs: 60, durationMs: 100, inputEventMs: 12, inputEventOutputUpdateMs: 100 }),
    makeSample({ inputFillMs: 20, outputUpdateMs: 80, durationMs: 100, inputEventMs: 10, inputEventOutputUpdateMs: 90 }),
    makeSample({ inputFillMs: 100, outputUpdateMs: 50, durationMs: 150, inputEventMs: 20, inputEventOutputUpdateMs: 130 }),
  ], [{ name: 'stress' }]);

  assert.deepEqual(summary.interactions['json.stress'], {
    samples: 3,
    median: 100,
    p95: 150,
  });
  assert.deepEqual(summary.interactions.jsonInputFill.stress, {
    samples: 3,
    median: 40,
    p95: 100,
  });
  assert.deepEqual(summary.interactions.jsonOutputUpdate.stress, {
    samples: 3,
    median: 60,
    p95: 80,
  });
  assert.deepEqual(summary.interactions.jsonBulkInputEvent.stress, {
    samples: 3,
    median: 12,
    p95: 20,
  });
  assert.deepEqual(summary.interactions.jsonBulkInputEventOutputUpdate.stress, {
    samples: 3,
    median: 100,
    p95: 130,
  });
});
